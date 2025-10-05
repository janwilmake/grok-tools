// @ts-check
/// <reference types="@cloudflare/workers-types" />
/// <reference lib="esnext" />
import {
  handleOAuth,
  getCurrentUser,
  getAccessToken,
  type Env as OAuthEnv,
} from "smootherauth-github";

// Extend the Env interface to include KV binding
export interface Env extends OAuthEnv {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  USER_DATA: KVNamespace;
}

interface UserData {
  x_username?: string | null;
  bio?: string | null;
  context?: string;
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    // Handle OPTIONS request for CORS
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Handle OAuth routes first
    const oauthResponse = await handleOAuth(request, env, "user:email");
    if (oauthResponse) {
      // If this is a successful callback, redirect to dashboard
      if (path === "/callback" && oauthResponse.status === 302) {
        const user = getCurrentUser(request);
        if (user) {
          const headers = new Headers(oauthResponse.headers);
          headers.set("Location", "/dashboard");
          return new Response(null, { status: 302, headers });
        }
      }
      return oauthResponse;
    }

    // Dashboard route
    if (path === "/dashboard") {
      const user = getCurrentUser(request);
      if (!user) {
        return new Response(null, {
          status: 302,
          headers: { Location: "/login?redirect_to=/dashboard" },
        });
      }

      try {
        const dashboardHtml = await env.USER_DATA.get("static:dashboard.html");
        if (dashboardHtml) {
          return new Response(dashboardHtml, {
            headers: { "Content-Type": "text/html" },
          });
        }
        // Fallback to serve from assets if not in KV
        return fetch(new Request(`${url.origin}/dashboard.html`));
      } catch (error) {
        return new Response("Dashboard temporarily unavailable", {
          status: 500,
        });
      }
    }

    // Root path - show usage for API, homepage for browsers
    if (path === "/auth") {
      const acceptHeader = request.headers.get("Accept") || "";
      // Return API documentation for non-HTML requests
      const user = getCurrentUser(request);
      const usage = {
        description: "GitHub to X Username Lookup API with OAuth",
        authenticated_user: user
          ? {
              username: user.login,
              avatar: user.avatar_url,
            }
          : null,
        auth: {
          login: `${url.origin}/login`,
          logout: `${url.origin}/logout`,
          dashboard: `${url.origin}/dashboard`,
        },
        usage: {
          get_profile: {
            endpoint: "GET /{username}",
            example: `${url.origin}/octocat`,
            description: "Get user profile (merges authorized and public data)",
            content_types: {
              "text/html": "Interactive chat interface",
              "application/json": "Raw profile data",
              "text/markdown": "AI context for LLMs",
            },
          },
          set_authorized: {
            endpoint: "POST /{username}/set",
            description: "Set your own profile data (requires GitHub auth)",
            auth_required: true,
            body: {
              x_username: "string|null",
              bio: "string|null",
              context: "string",
            },
          },
          set_public: {
            endpoint: "POST /{username}/set",
            description: "Set any user's public profile data",
            auth_required: false,
            body: {
              x_username: "string|null",
              bio: "string|null",
              context: "string",
            },
          },
        },
      };

      return new Response(JSON.stringify(usage, null, 2), {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      });
    }

    // Parse username from path
    const pathMatch = path.match(/^\/([^\/]+)(?:\/(.+))?$/);
    if (!pathMatch) {
      return new Response("Not Found", { status: 404 });
    }

    const [, username, action] = pathMatch;

    // Validate username format
    if (!username || !/^[a-zA-Z0-9\-_]+$/.test(username)) {
      return new Response(
        JSON.stringify({ error: "Invalid username format" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        },
      );
    }

    // Handle POST /{username}/set
    if (action === "set" && request.method === "POST") {
      return handleSetUserData(request, env, username, corsHeaders);
    }

    // Handle GET /{username}
    if (!action && request.method === "GET") {
      return handleGetUserProfile(request, env, username, corsHeaders);
    }

    return new Response("Not Found", { status: 404 });
  },
};

async function handleSetUserData(
  request: Request,
  env: Env,
  username: string,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  try {
    const body = (await request.json()) as UserData;

    // Validate body structure
    if (typeof body !== "object" || body === null) {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      });
    }

    // Validate input data
    if (body.x_username && !/^[a-zA-Z0-9_]{1,15}$/.test(body.x_username)) {
      return new Response(
        JSON.stringify({ error: "Invalid X username format" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        },
      );
    }

    if (body.bio && body.bio.length > 500) {
      return new Response(
        JSON.stringify({ error: "Bio too long (max 500 characters)" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        },
      );
    }

    if (body.context && body.context.length > 50000) {
      return new Response(
        JSON.stringify({ error: "Context too long (max 50,000 characters)" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        },
      );
    }

    // Check if user is authenticated and if they're setting their own data
    const currentUser = getCurrentUser(request);
    const isAuthorized = currentUser && currentUser.login === username;

    let key: string;
    let keyType: string;

    if (isAuthorized) {
      key = `authorized:${username}`;
      keyType = "authorized";
    } else {
      key = `public:${username}`;
      keyType = "public";
    }

    // Store in KV
    await env.USER_DATA.put(key, JSON.stringify(body));

    return new Response(
      JSON.stringify({
        success: true,
        message: `${keyType} data updated for ${username}`,
        data: body,
        key_type: keyType,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      },
    );
  } catch (error) {
    console.error("Error setting user data:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to set user data",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      },
    );
  }
}

async function handleGetUserProfile(
  request: Request,
  env: Env,
  username: string,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  try {
    const acceptHeader = request.headers.get("Accept") || "";
    const isHtmlRequest = acceptHeader.includes("text/html");
    const isMarkdownRequest =
      acceptHeader.includes("text/markdown") ||
      acceptHeader.includes("text/plain");

    // Fetch from GitHub API first (fallback data)
    let githubData: any = null;
    let githubError: string | null = null;

    try {
      const githubResponse = await fetch(
        `https://api.github.com/users/${username}`,
        {
          headers: {
            "User-Agent": "XYSelf-Bot/1.0",
          },
        },
      );

      if (githubResponse.ok) {
        githubData = await githubResponse.json();
      } else if (githubResponse.status === 404) {
        githubError = "GitHub user not found";
      } else {
        githubError = `GitHub API error: ${githubResponse.status}`;
      }
    } catch (error) {
      console.error("GitHub API error:", error);
      githubError = "Failed to fetch from GitHub";
    }

    // Get stored data from KV
    const [authorizedData, publicData] = await Promise.all([
      env.USER_DATA.get(
        `authorized:${username}`,
        "json",
      ) as Promise<UserData | null>,
      env.USER_DATA.get(
        `public:${username}`,
        "json",
      ) as Promise<UserData | null>,
    ]);

    // Start with GitHub data as base
    let result: any = {
      github_username: username,
      x_username: null,
      profile_picture: null,
      bio: null,
      context: "",
    };

    // If we have GitHub data, use it as base
    if (githubData) {
      result.github_username = githubData.login;
      result.profile_picture = githubData.avatar_url;
      result.bio = githubData.bio || null;

      // Extract X username from GitHub data
      if (githubData.twitter_username) {
        result.x_username = githubData.twitter_username;
      } else if (githubData.blog) {
        const blogUrl = githubData.blog.toLowerCase();
        const twitterMatch = blogUrl.match(
          /(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/,
        );
        if (twitterMatch) {
          result.x_username = twitterMatch[1];
        }
      }

      // Build default context
      const contextParts = [
        `You are an AI clone of ${username}. You have been provided with context about this person including their social media posts, projects, and professional information.

## Core Behavior Guidelines:

1. **Speak in their voice**: Analyze the provided context to understand their communication style, technical expertise, interests, and personality. Mirror their tone, vocabulary, and way of expressing ideas.

2. **Only discuss what you know**: Base all responses strictly on the information provided in your context. Do not invent, assume, or extrapolate beyond what is explicitly stated.

3. **When uncertain, redirect**: If asked about something not covered in your context, respond with: "I don't have information about that in my current context. You might want to check [relevant URL from context] or ask me about something I do know about."

4. **Reference your projects and interests**: Draw from the specific projects, tools, and topics mentioned in your context. Speak about them as if they are your own work and interests.

5. **Use markdown links**: When referencing external information or suggesting where to find more details, always use proper markdown link format: \`[descriptive text](URL)\`

6. **Maintain authenticity**: Don't claim to be the real person, but embody their perspective based on the provided context. You can say things like "Based on my work with..." or "In my experience building..."

## Response Structure:
- Stay in character throughout
- Reference specific projects, tweets, or experiences from your context when relevant
- Be helpful but honest about the limits of your knowledge
- Suggest specific URLs from your context when appropriate

Remember: You are ${username} as represented by the provided context. Speak authentically as them, but always within the bounds of what you actually know from that context.
`,
        "",
        "## Context Sources:",
      ];
      if (result.x_username) {
        contextParts.push(
          `- X Posts: https://xymake.com/${result.x_username}.md`,
        );
      }
      contextParts.push(
        `- GitHub Profile: https://flaredream.com/${githubData.login}`,
      );
      result.context = contextParts.join("\n");
    }

    // Merge with public data if available
    if (publicData) {
      if (publicData.x_username !== undefined)
        result.x_username = publicData.x_username;
      if (publicData.bio !== undefined) result.bio = publicData.bio;
      if (publicData.context !== undefined) result.context = publicData.context;
    }

    // Merge with authorized data if available (highest priority)
    if (authorizedData) {
      if (authorizedData.x_username !== undefined)
        result.x_username = authorizedData.x_username;
      if (authorizedData.bio !== undefined) result.bio = authorizedData.bio;
      if (authorizedData.context !== undefined)
        result.context = authorizedData.context;
    }

    // Add metadata about data sources
    result._metadata = {
      sources: {
        github: !!githubData,
        public_override: !!publicData,
        authorized_override: !!authorizedData,
      },
      github_error: githubError,
    };

    // Return appropriate format based on Accept header
    if (isHtmlRequest) {
      // Return interactive chat interface
      const chatHtml = generateChatInterface(result);
      return new Response(chatHtml, {
        headers: {
          "Content-Type": "text/html",
          ...corsHeaders,
        },
      });
    } else if (isMarkdownRequest) {
      // Return just the context for AI consumption
      return new Response(result.context || "No context available", {
        headers: {
          "Content-Type": "text/markdown",
          ...corsHeaders,
        },
      });
    } else {
      // Return JSON data
      return new Response(JSON.stringify(result, null, 2), {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      });
    }
  } catch (error) {
    console.error("Error fetching user profile:", error);

    return new Response(
      JSON.stringify({
        error: "Failed to fetch user profile",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      },
    );
  }
}

function generateChatInterface(profile: any): string {
  const hasContext = profile.context && profile.context.trim();
  const displayName = profile.github_username || "Unknown User";
  const bio = profile.bio || "No bio available";

  return `<!DOCTYPE html>
<html lang="en" class="bg-black">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Chat with ${displayName} - XYSelf</title>
    <meta name="description" content="Chat with an AI version of ${displayName} powered by their social media content and context." />
    <meta name="robots" content="index, follow" />
    
    <!-- Open Graph -->
    <meta property="og:title" content="Chat with ${displayName}" />
    <meta property="og:description" content="Chat with an AI version of ${displayName} powered by their social media content and context." />
    <meta property="og:image" content="${
      profile.profile_picture || "https://via.placeholder.com/400x400"
    }" />
    <meta property="og:url" content="https://xyself.com/${
      profile.github_username
    }" />
    
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        @import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap");
        body { font-family: "Inter", sans-serif; }
        .xy-gradient { background: linear-gradient(135deg, #000000 0%, #121212 100%); }
        .xy-border { border: 1px solid rgba(255, 255, 255, 0.1); }
    </style>
</head>
<body class="text-white">
    <main class="min-h-screen xy-gradient">
        <div class="max-w-4xl mx-auto px-4 py-8">
            <!-- Header -->
            <div class="xy-border rounded-xl p-6 bg-white/5 mb-8">
                <div class="flex items-center gap-4 mb-4">
                    ${
                      profile.profile_picture
                        ? `<img src="${profile.profile_picture}" class="w-16 h-16 rounded-full xy-border" alt="${displayName}">`
                        : ""
                    }
                    <div>
                        <h1 class="text-3xl font-bold">${displayName}</h1>
                        <p class="text-gray-300">${bio}</p>
                        ${
                          profile.x_username
                            ? `<a href="https://x.com/${profile.x_username}" target="_blank" class="text-blue-400 hover:underline">@${profile.x_username}</a>`
                            : ""
                        }
                    </div>
                </div>
                ${
                  hasContext
                    ? `<div class="mb-4">
                        <span class="inline-flex items-center px-3 py-1 rounded-full text-sm bg-green-600/20 text-green-400">
                            ✓ AI Clone Available
                        </span>
                    </div>`
                    : `<div class="mb-4">
                        <span class="inline-flex items-center px-3 py-1 rounded-full text-sm bg-red-600/20 text-red-400">
                            ⚠ No AI Context Available
                        </span>
                    </div>`
                }
            </div>

            ${
              hasContext
                ? `<!-- Chat Interface -->
                <div class="xy-border rounded-xl p-6 bg-white/5">
                    <h2 class="text-xl font-bold mb-4">Chat with ${displayName}'s AI Clone</h2>
                    <div class="mb-4">
                        <a href="https://letmeprompt.com/?q=${encodeURIComponent(
                          profile.context,
                        )}" 
                           target="_blank"
                           class="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg font-medium transition-all inline-flex items-center gap-2">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z"></path>
                            </svg>
                            Start Chatting
                        </a>
                    </div>
                    <p class="text-sm text-gray-400">
                        This will open a chat interface where you can talk to an AI version of ${displayName} 
                        based on their social media content and context.
                    </p>
                </div>`
                : `<!-- No Context Available -->
                <div class="xy-border rounded-xl p-6 bg-white/5">
                    <h2 class="text-xl font-bold mb-4">AI Clone Not Available</h2>
                    <p class="text-gray-300 mb-4">
                        ${displayName} hasn't set up their AI context yet, so their AI clone isn't available for chat.
                    </p>
                    <p class="text-sm text-gray-400">
                        If you're ${displayName}, you can <a href="/login" class="text-blue-400 hover:underline">log in</a> 
                        to set up your AI clone context.
                    </p>
                </div>`
            }

            <!-- Back to Home -->
            <div class="mt-8 text-center">
                <a href="/" class="text-blue-400 hover:underline">← Back to XYSelf</a>
            </div>
        </div>
    </main>
</body>
</html>`;
}
