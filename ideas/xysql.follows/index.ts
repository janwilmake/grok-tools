import {
  createClient,
  Env as StripeflareEnv,
  stripeBalanceMiddleware,
  type StripeUser,
} from "stripeflare";

export { DORM } from "stripeflare";

interface Env extends StripeflareEnv {
  TWITTER_API_KEY: string;
  FREEMYX_API_URL: string;
}

interface User extends StripeUser {
  username: string;
  followers_count: number;
  last_sync: string | null;
}

interface Following {
  id: string;
  follow_username: string;
  user_access_token: string;
  username: string;
  name: string;
  url: string;
  is_blue_verified: boolean;
  verified_type: string;
  profile_picture: string;
  description: string;
  location: string;
  followers: number;
  following: number;
  created_at: string;
  favourites_count: number;
  statuses_count: number;
  last_updated: string;
}

export const migrations = {
  1: [
    `CREATE TABLE users (
      access_token TEXT PRIMARY KEY,
      balance INTEGER DEFAULT 0,
      name TEXT,
      email TEXT,
      verified_email TEXT,
      verified_user_access_token TEXT,
      card_fingerprint TEXT,
      client_reference_id TEXT,
      username TEXT,
      followers_count INTEGER DEFAULT 0,
      last_sync TEXT
    )`,
    `CREATE INDEX idx_users_username ON users(username)`,
    `CREATE INDEX idx_users_balance ON users(balance)`,
    `CREATE INDEX idx_users_last_sync ON users(last_sync)`,
    `CREATE TABLE followings (
      id TEXT PRIMARY KEY,
      follow_username TEXT NOT NULL,
      user_access_token TEXT NOT NULL,
      username TEXT NOT NULL,
      name TEXT,
      url TEXT,
      is_blue_verified BOOLEAN DEFAULT FALSE,
      verified_type TEXT,
      profile_picture TEXT,
      description TEXT,
      location TEXT,
      followers INTEGER DEFAULT 0,
      following INTEGER DEFAULT 0,
      created_at TEXT,
      favourites_count INTEGER DEFAULT 0,
      statuses_count INTEGER DEFAULT 0,
      last_updated TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_access_token) REFERENCES users(access_token)
    )`,
    `CREATE INDEX idx_followings_user_token ON followings(user_access_token)`,
    `CREATE INDEX idx_followings_follow_username ON followings(follow_username)`,
    `CREATE INDEX idx_followings_username ON followings(username)`,
  ],
};

class TwitterAPIClient {
  constructor(private apiKey: string) {}

  async getUserByUsername(username: string): Promise<any> {
    const response = await fetch(
      `https://api.twitterapi.io/twitter/user/${username}`,
      {
        headers: {
          "X-API-Key": this.apiKey,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Twitter API error: ${response.status}`);
    }

    return response.json();
  }

  async getUserFollowings(
    username: string,
    cursor: string = "",
    pageSize: number = 200,
  ): Promise<any> {
    const params = new URLSearchParams({
      userName: username,
      pageSize: pageSize.toString(),
    });

    if (cursor) {
      params.append("cursor", cursor);
    }

    const response = await fetch(
      `https://api.twitterapi.io/twitter/user/followings?${params}`,
      {
        headers: {
          "X-API-Key": this.apiKey,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Twitter API error: ${response.status}`);
    }

    return response.json();
  }

  transformUserData(userData: any): Partial<Following> {
    return {
      id: userData.id,
      username: userData.userName,
      name: userData.name,
      url: userData.url,
      is_blue_verified: userData.isBlueVerified || false,
      verified_type: userData.verifiedType || "",
      profile_picture: userData.profilePicture || "",
      description: userData.description || "",
      location: userData.location || "",
      followers: userData.followers || 0,
      following: userData.following || 0,
      created_at: userData.createdAt || "",
      favourites_count: userData.favouritesCount || 0,
      statuses_count: userData.statusesCount || 0,
    };
  }
}

async function checkFreeMyXStatus(
  username: string,
  freemyxUrl: string,
): Promise<{ liberated: boolean; public: boolean; me: boolean }> {
  try {
    const response = await fetch(`${freemyxUrl}/${username}`);

    if (response.ok) {
      const data = await response.json();
      return {
        liberated: data.liberated || false,
        public: data.public || false,
        me: data.me || false,
      };
    }

    return { liberated: false, public: false, me: false };
  } catch {
    return { liberated: false, public: false, me: false };
  }
}

function generateMarkdown(followings: Following[], username: string): string {
  const sortedFollowings = followings.sort((a, b) => b.followers - a.followers);

  const markdown = `# Following List for @${username}

Last updated: ${new Date().toISOString()}
Total following: ${followings.length}

## Summary Statistics

- **Total Following**: ${followings.length}
- **Verified Users**: ${followings.filter((f) => f.is_blue_verified).length}
- **Most Followed**: @${
    sortedFollowings[0]?.username
  } (${sortedFollowings[0]?.followers.toLocaleString()} followers)

## Following List

${sortedFollowings
  .map(
    (following) => `### @${following.username}${
      following.is_blue_verified ? " ✓" : ""
    }

**Name**: ${following.name}
**Followers**: ${following.followers.toLocaleString()}
**Following**: ${following.following.toLocaleString()}
**Description**: ${following.description}
${following.location ? `**Location**: ${following.location}` : ""}
**Profile**: ${following.url}
**Joined**: ${following.created_at}

---`,
  )
  .join("\n\n")}

---
*Generated by Following Sync - Data liberated via Free My X*
`;

  return markdown;
}

async function syncUserFollowings(
  client: ReturnType<typeof createClient>,
  twitterClient: TwitterAPIClient,
  user: User,
): Promise<{ charged: number; followingsCount: number }> {
  let cursor = "";
  let allFollowings: Following[] = [];
  let totalCharged = 0;

  do {
    const response = await twitterClient.getUserFollowings(
      user.username,
      cursor,
    );

    if (response.status !== "success") {
      throw new Error(`Failed to fetch followings: ${response.message}`);
    }

    const transformedFollowings = response.followings.map((following: any) => ({
      ...twitterClient.transformUserData(following),
      follow_username: user.username,
      user_access_token: user.access_token,
      last_updated: new Date().toISOString(),
    }));

    allFollowings.push(...transformedFollowings);
    cursor = response.next_cursor || "";

    // Charge user for each page (200 followings per page)
    const chargeAmount = 4; // $0.04 per page (200 followings)
    await client
      .exec(
        "UPDATE users SET balance = balance - ? WHERE access_token = ?",
        chargeAmount,
        user.access_token,
      )
      .toArray();

    totalCharged += chargeAmount;
  } while (cursor && cursor !== "");

  // Clear existing followings for this user
  await client
    .exec(
      "DELETE FROM followings WHERE user_access_token = ?",
      user.access_token,
    )
    .toArray();

  // Insert new followings
  for (const following of allFollowings) {
    await client
      .exec(
        `INSERT INTO followings (
        id, follow_username, user_access_token, username, name, url,
        is_blue_verified, verified_type, profile_picture, description,
        location, followers, following, created_at, favourites_count,
        statuses_count, last_updated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        following.id,
        following.follow_username,
        following.user_access_token,
        following.username,
        following.name,
        following.url,
        following.is_blue_verified,
        following.verified_type,
        following.profile_picture,
        following.description,
        following.location,
        following.followers,
        following.following,
        following.created_at,
        following.favourites_count,
        following.statuses_count,
        following.last_updated,
      )
      .toArray();
  }

  // Update user's last sync time
  await client
    .exec(
      "UPDATE users SET last_sync = ? WHERE access_token = ?",
      new Date().toISOString(),
      user.access_token,
    )
    .toArray();

  return { charged: totalCharged, followingsCount: allFollowings.length };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const cronjob = async (env: Env, ctx: ExecutionContext) => {
  const twitterClient = new TwitterAPIClient(env.TWITTER_API_KEY);

  const client = createClient({
    doNamespace: env.DORM_NAMESPACE,
    ctx,
    migrations,
    mirrorName: "aggregate",
    name: "main",
    version: "1.0.0",
  });

  try {
    // Get all users with balance > 1 (need at least $0.01 for sync)
    const usersToSync = await client
      .exec<User>(
        "SELECT * FROM users WHERE balance > 100 AND username IS NOT NULL",
      )
      .toArray();

    const results = [];

    for (const user of usersToSync) {
      try {
        const syncResult = await syncUserFollowings(
          client,
          twitterClient,
          user,
        );
        results.push({
          username: user.username,
          success: true,
          charged: syncResult.charged,
          followingsCount: syncResult.followingsCount,
        });
      } catch (error) {
        results.push({
          username: user.username,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return new Response(
      JSON.stringify(
        {
          message: "Cronjob completed",
          results,
          totalUsers: usersToSync.length,
        },
        null,
        2,
      ),
      {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Cronjob failed",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      },
    );
  }
};

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Handle stripeflare middleware
    const result = await stripeBalanceMiddleware<User>(
      request,
      env,
      ctx,
      migrations,
      "1.0.0",
    );

    if (result.response) {
      return result.response;
    }

    const url = new URL(request.url);
    const twitterClient = new TwitterAPIClient(env.TWITTER_API_KEY);

    // Static file serving
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(indexHTML, {
        headers: { "Content-Type": "text/html", ...corsHeaders },
      });
    }

    // Cronjob endpoint
    if (url.pathname === "/cronjob") {
      return cronjob(env, ctx);
    }

    // Followers count endpoint
    if (url.pathname.startsWith("/followers/")) {
      const username = url.pathname.split("/followers/")[1];

      if (!username) {
        return new Response("Username required", { status: 400 });
      }

      try {
        const userData = await twitterClient.getUserByUsername(username);

        console.log({ userData });
        if (userData.status === "success" && userData.data) {
          return new Response(
            JSON.stringify({
              username: userData.data.userName,
              followers: userData.data.followers || 0,
              following: userData.data.following || 0,
              name: userData.data.name,
            }),
            {
              headers: {
                "Content-Type": "application/json",
                "Cache-Control": "public, max-age=604800", // 1 week cache
                ...corsHeaders,
              },
            },
          );
        } else {
          return new Response("User not found", { status: 404 });
        }
      } catch (error) {
        return new Response("Failed to fetch user data", { status: 500 });
      }
    }

    // User followings endpoint
    const usernameMatch = url.pathname.match(/^\/([^\/\.]+)(\.md|\.json)?$/);
    if (usernameMatch) {
      const username = usernameMatch[1];
      const format = usernameMatch[2]?.slice(1) || "md"; // Default to markdown

      if (username === "me") {
        return new Response("Use /me endpoint for authentication data", {
          status: 400,
        });
      }

      // Check Free My X status
      const freeMyXStatus = await checkFreeMyXStatus(
        username,
        env.FREEMYX_API_URL || "https://freemyx.com",
      );

      if (
        !freeMyXStatus.liberated ||
        (!freeMyXStatus.public && !freeMyXStatus.me)
      ) {
        return new Response(
          JSON.stringify({
            error: "Access denied",
            message:
              "User must liberate their data with at least 'me' access level",
            username,
            liberated: freeMyXStatus.liberated,
            public: freeMyXStatus.public,
            me: freeMyXStatus.me,
          }),
          {
            status: 403,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          },
        );
      }

      const client = createClient({
        doNamespace: env.DORM_NAMESPACE,
        ctx,
        migrations,
        mirrorName: "aggregate",
        name: "main",
        version: "1.0.0",
      });

      try {
        // Get user data
        const user = await client
          .exec<User>("SELECT * FROM users WHERE username = ?", username)
          .one()
          .catch(() => null);

        if (!user) {
          return new Response("User not found in database", { status: 404 });
        }

        // Get followings
        const followings = await client
          .exec<Following>(
            "SELECT * FROM followings WHERE user_access_token = ? ORDER BY followers DESC",
            user.access_token,
          )
          .toArray();

        if (format === "json") {
          return new Response(
            JSON.stringify(
              {
                username,
                last_sync: user.last_sync,
                followings_count: followings.length,
                followings,
              },
              null,
              2,
            ),
            {
              headers: { "Content-Type": "application/json", ...corsHeaders },
            },
          );
        } else {
          const markdown = generateMarkdown(followings, username);
          return new Response(markdown, {
            headers: {
              "Content-Type": "text/markdown; charset=utf-8",
              "Content-Disposition": `attachment; filename="${username}-followings.md"`,
              ...corsHeaders,
            },
          });
        }
      } catch (error) {
        return new Response("Database error", { status: 500 });
      }
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    await cronjob(env, ctx);
  },
};

const indexHTML = `<!DOCTYPE html>
<html lang="en" class="bg-black">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Following Sync - LLM-Friendly X Data</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body { font-family: "Inter", sans-serif; }
        .liberation-gradient { 
            background: linear-gradient(135deg, #000000 0%, #1a1a2e 50%, #16213e 100%); 
        }
        .free-border { 
            border: 1px solid rgba(34, 197, 94, 0.3); 
        }
        .button-glow:hover {
            box-shadow: 0 0 30px rgba(34, 197, 94, 0.6);
        }
        .step-active { border-color: #22c55e; background-color: rgba(34, 197, 94, 0.1); }
        .step-complete { border-color: #22c55e; background-color: rgba(34, 197, 94, 0.2); }
        .step-incomplete { border-color: #374151; background-color: rgba(55, 65, 81, 0.1); }
    </style>
</head>
<body class="text-white liberation-gradient min-h-screen">
    <div class="max-w-4xl mx-auto px-4 py-16">
        <!-- Header -->
        <div class="text-center mb-12">
            <h1 class="text-4xl font-bold mb-4">📊 Following Sync</h1>
            <p class="text-xl text-gray-400">Get LLM-friendly markdown of your X followings, synced daily</p>
            <div class="mt-4 text-sm text-green-400">
                <span class="inline-flex items-center gap-2">
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
                    </svg>
                    Privacy-first with Free My X integration
                </span>
            </div>
        </div>

        <!-- Steps -->
        <div class="space-y-6">
            <!-- Step 1: Username -->
            <div id="step1" class="free-border rounded-xl p-8 step-active">
                <div class="flex items-center gap-3 mb-6">
                    <div id="step1-icon" class="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center font-bold">1</div>
                    <h2 class="text-2xl font-bold">Enter Your X Username</h2>
                </div>
                
                <div class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-300 mb-2">X Username (without @)</label>
                        <div class="flex gap-3">
                            <input 
                                type="text" 
                                id="username" 
                                placeholder="your_username"
                                class="flex-1 bg-gray-800/50 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:border-green-500 focus:outline-none"
                            >
                            <button 
                                onclick="checkUsername()"
                                class="bg-green-600 hover:bg-green-700 px-6 py-3 rounded-lg font-bold transition-all button-glow"
                            >
                                Check Stats
                            </button>
                        </div>
                    </div>
                    
                    <div id="userStats" class="hidden bg-green-900/20 border border-green-500/30 rounded-lg p-4">
                        <!-- Stats will be populated here -->
                    </div>
                </div>
            </div>

            <!-- Step 2: Free My X -->
            <div id="step2" class="free-border rounded-xl p-8 step-incomplete">
                <div class="flex items-center gap-3 mb-6">
                    <div id="step2-icon" class="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center font-bold">2</div>
                    <h2 class="text-2xl font-bold">Free Your X Data</h2>
                </div>
                
                <div id="freeMyXCheck" class="space-y-4">
                    <p class="text-gray-300">You need to liberate your X data to allow access to your followings.</p>
                    
                    <div class="bg-blue-900/20 border border-blue-500/30 rounded-lg p-4">
                        <h4 class="font-bold text-blue-300 mb-2">Required Steps:</h4>
                        <ol class="text-sm text-blue-200 space-y-1 list-decimal list-inside">
                            <li>Visit Free My X to authenticate with your X account</li>
                            <li>Vote for data liberation with at least "Me" access level</li>
                            <li>Return here to continue setup</li>
                        </ol>
                    </div>
                    
                    <div class="flex gap-3">
                        <a 
                            href="https://freemyx.com" 
                            target="_blank"
                            class="bg-green-600 hover:bg-green-700 px-6 py-3 rounded-lg font-bold transition-all button-glow"
                        >
                            🔓 Free Your Data
                        </a>
                        <button 
                            onclick="checkFreeMyX()"
                            class="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg font-bold transition-all"
                        >
                            ↻ Check Status
                        </button>
                    </div>
                    
                    <div id="liberationStatus" class="hidden">
                        <!-- Liberation status will be shown here -->
                    </div>
                </div>
            </div>

            <!-- Step 3: Payment -->
            <div id="step3" class="free-border rounded-xl p-8 step-incomplete">
                <div class="flex items-center gap-3 mb-6">
                    <div id="step3-icon" class="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center font-bold">3</div>
                    <h2 class="text-2xl font-bold">Pay for Sync Service</h2>
                </div>
                
                <div id="paymentSection" class="space-y-4">
                    <div class="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-4">
                        <h4 class="font-bold text-yellow-300 mb-2">💰 Pricing</h4>
                        <p class="text-yellow-200 text-sm">$40 per 1,000 followings per year</p>
                        <div id="costEstimate" class="mt-2 text-yellow-100 font-medium">
                            <!-- Cost estimate will be calculated here -->
                        </div>
                    </div>
                    
                    <div id="paymentButtons" class="hidden">
                        <!-- Payment buttons will be shown here -->
                    </div>
                    
                    <div id="balanceStatus" class="hidden">
                        <!-- Balance status will be shown here -->
                    </div>
                </div>
            </div>

            <!-- Step 4: Get Data -->
            <div id="step4" class="free-border rounded-xl p-8 step-incomplete">
                <div class="flex items-center gap-3 mb-6">
                    <div id="step4-icon" class="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center font-bold">4</div>
                    <h2 class="text-2xl font-bold">Get Your Data</h2>
                </div>
                
                <div id="dataSection" class="space-y-4">
                    <p class="text-gray-300">Access your synchronized followings data in multiple formats.</p>
                    
                    <div id="dataButtons" class="hidden flex gap-3">
                        <a 
                            id="markdownLink"
                            href="#"
                            target="_blank"
                            class="bg-green-600 hover:bg-green-700 px-6 py-3 rounded-lg font-bold transition-all button-glow"
                        >
                            📄 Download Markdown
                        </a>
                        <a 
                            id="jsonLink"
                            href="#"
                            target="_blank"
                            class="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg font-bold transition-all"
                        >
                            📊 View JSON
                        </a>
                    </div>
                    
                    <div class="bg-gray-800/50 rounded-lg p-4">
                        <h4 class="font-bold mb-2">What you'll get:</h4>
                        <ul class="text-sm text-gray-300 space-y-1">
                            <li>• LLM-friendly markdown with all your followings</li>
                            <li>• Sorted by follower count for relevance</li>
                            <li>• Includes user stats, bios, and metadata</li>
                            <li>• Daily automatic updates</li>
                            <li>• JSON format for programmatic access</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>

        <!-- Footer -->
        <div class="text-center mt-12 text-sm text-gray-500">
            <p>Powered by <a href="https://freemyx.com" target="_blank" class="text-green-400 hover:text-green-300">Free My X</a> and Stripeflare</p>
            <p class="mt-2">Privacy-first following sync with daily updates</p>
        </div>
    </div>

    <script>
        let currentUsername = '';
        let userStats = null;
        let liberationData = null;
        let paymentData = null;

        // Step management
        function updateStepStatus(stepNum, status) {
            const step = document.getElementById(\`step\${stepNum}\`);
            const icon = document.getElementById(\`step\${stepNum}-icon\`);
            
            step.className = step.className.replace(/step-(active|complete|incomplete)/, \`step-\${status}\`);
            
            if (status === 'complete') {
                icon.innerHTML = '✓';
                icon.className = icon.className.replace('bg-gray-600', 'bg-green-600');
                icon.className = icon.className.replace('bg-blue-600', 'bg-green-600');
            } else if (status === 'active') {
                icon.className = icon.className.replace('bg-gray-600', 'bg-blue-600');
            }
        }

        // Step 1: Username check
        async function checkUsername() {
            const username = document.getElementById('username').value.trim();
            
            if (!username) {
                alert('Please enter a username');
                return;
            }

            currentUsername = username;
            
            try {
                const response = await fetch(\`/followers/\${username}\`);
                
                if (response.ok) {
                    userStats = await response.json();
                    
                    document.getElementById('userStats').innerHTML = \`
                        <div class="flex items-center gap-4">
                            <div class="text-center">
                                <div class="text-2xl font-bold text-green-400">\${userStats.followers.toLocaleString()}</div>
                                <div class="text-sm text-gray-400">Followers</div>
                            </div>
                            <div class="text-center">
                                <div class="text-2xl font-bold text-blue-400">\${userStats.following.toLocaleString()}</div>
                                <div class="text-sm text-gray-400">Following</div>
                            </div>
                            <div class="flex-1">
                                <div class="font-medium text-white">\${userStats.name}</div>
                                <div class="text-sm text-gray-400">@\${userStats.username}</div>
                            </div>
                        </div>
                    \`;
                    
                    document.getElementById('userStats').classList.remove('hidden');
                    updateStepStatus(1, 'complete');
                    updateStepStatus(2, 'active');
                    
                    // Update cost estimate
                    const yearlyFollowingCost = Math.ceil(userStats.following / 1000 * 40);
                    document.getElementById('costEstimate').innerHTML = \`
                        Estimated cost: $\${yearlyFollowingCost}/year for \${userStats.following.toLocaleString()} followings
                    \`;
                    
                    // Check Free My X status
                    await checkFreeMyX();
                    
                } else {
                    alert('User not found or API error');
                }
            } catch (error) {
                alert('Error checking username: ' + error.message);
            }
        }

        // Step 2: Free My X check
        async function checkFreeMyX() {
            if (!currentUsername) return;
            
            try {
                const response = await fetch(\`https://freemyx.com/\${currentUsername}\`);
                
                if (response.ok) {
                    liberationData = await response.json();
                    
                    if(liberationData.liberated){
                    
                    document.getElementById('liberationStatus').innerHTML = \`
                        <div class="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                            <div class="flex items-center gap-3 mb-2">
                                <div class="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                                    <svg class="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                                        <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
                                    </svg>
                                </div>
                                <span class="font-bold text-green-400">✅ Data Liberated!</span>
                            </div>
                            <p class="text-green-200 text-sm">
                                Access level: \${liberationData.public ? 'Public' : 'Me'} - You can proceed with payment
                            </p>
                        </div>
                    \`;
                    
                    document.getElementById('liberationStatus').classList.remove('hidden');
                    updateStepStatus(2, 'complete');
                    updateStepStatus(3, 'active');
                    
                    // Setup payment section
                    setupPaymentSection();
                    
                    }
                } else if (response.status === 403||response.status===404) {
                    const errorData = await response.json();
                    
                    document.getElementById('liberationStatus').innerHTML = \`
                        <div class="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                            <div class="flex items-center gap-3 mb-2">
                                <div class="w-6 h-6 bg-red-500 rounded-full flex items-center justify-center">
                                    <svg class="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                                        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
                                    </svg>
                                </div>
                                <span class="font-bold text-red-400">❌ Not Liberated</span>
                            </div>
                            <p class="text-red-200 text-sm">\${errorData.message}</p>
                        </div>
                    \`;
                    
                    document.getElementById('liberationStatus').classList.remove('hidden');
                }
            } catch (error) {
                console.error('Error checking Free My X:', error);
            }
        }

        // Step 3: Payment setup
        async function setupPaymentSection() {
            try {
                const response = await fetch('/me');
                
                if (response.ok) {
                    paymentData = await response.json();
                    
                    if (paymentData.balance > 0) {
                        document.getElementById('balanceStatus').innerHTML = \`
                            <div class="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                                <div class="flex items-center justify-between">
                                    <div>
                                        <div class="font-bold text-green-400">✅ Payment Complete</div>
                                        <div class="text-green-200 text-sm">Balance: $\${(paymentData.balance / 100).toFixed(2)}</div>
                                    </div>
                                    <a href="\${paymentData.payment_link}" target="_blank" 
                                       class="bg-green-600 hover:bg-green-700 px-4 py-2 rounded font-medium transition-all">
                                        Add More
                                    </a>
                                </div>
                            </div>
                        \`;
                        
                        document.getElementById('balanceStatus').classList.remove('hidden');
                        updateStepStatus(3, 'complete');
                        updateStepStatus(4, 'active');
                        setupDataSection();
                        
                    } else {
                        const recommendedAmount = userStats ? Math.ceil(userStats.following / 1000 * 40) : 40;
                        
                        document.getElementById('paymentButtons').innerHTML = \`
                            <a href="\${paymentData.payment_link}?client_reference_id=\${paymentData.client_reference_id}" 
                               target="_blank"
                               class="bg-green-600 hover:bg-green-700 px-6 py-3 rounded-lg font-bold transition-all button-glow">
                                💳 Pay $\${recommendedAmount} (Recommended)
                            </a>
                        \`;
                        
                        document.getElementById('paymentButtons').classList.remove('hidden');
                    }
                } else {
                    // User not authenticated yet
                    document.getElementById('paymentButtons').innerHTML = \`
                        <p class="text-gray-300 mb-4">You need to authenticate first to make a payment.</p>
                        <a href="/login" 
                           class="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg font-bold transition-all">
                            🔐 Login to Continue
                        </a>
                    \`;
                    
                    document.getElementById('paymentButtons').classList.remove('hidden');
                }
            } catch (error) {
                console.error('Error setting up payment:', error);
            }
        }

        // Step 4: Data access
        function setupDataSection() {
            document.getElementById('markdownLink').href = \`/\${currentUsername}.md\`;
            document.getElementById('jsonLink').href = \`/\${currentUsername}.json\`;
            document.getElementById('dataButtons').classList.remove('hidden');
        }

        // Auto-check when page gains focus (user returns from other tabs)
        window.addEventListener('focus', function() {
            if (currentUsername && liberationData) {
                setTimeout(() => {
                    setupPaymentSection();
                }, 1000);
            }
        });

        // Allow Enter key in username field
        document.getElementById('username').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                checkUsername();
            }
        });
    </script>
</body>
</html>`;
