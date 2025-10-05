// @ts-check
/// <reference types="@cloudflare/workers-types" />
/// <reference lib="esnext" />

/**
 * XFollows - A service to get your Twitter following list as markdown
 * Deployed on xfollows.markdownfeed.com
 *
 * @typedef {Object} Env
 * @property {KVNamespace} KV_NAMESPACE
 * @property {string} TWITTER_API_KEY
 */

/**
 * @typedef {Object} UserInfo
 * @property {string} userName
 * @property {string} url
 * @property {string} id
 * @property {string} name
 * @property {boolean} isBlueVerified
 * @property {string} [verifiedType]
 * @property {string} profilePicture
 * @property {string} description
 * @property {string} [location]
 * @property {number} followers
 * @property {number} following
 * @property {string} createdAt
 * @property {number} favouritesCount
 * @property {number} statusesCount
 */

/**
 * @typedef {Object} FollowingsResponse
 * @property {UserInfo[]} followings
 * @property {boolean} has_next_page
 * @property {string} next_cursor
 * @property {string} status
 * @property {string} message
 */

export default {
  /**
   * Main fetch handler
   * @param {Request} request
   * @param {Env} env
   * @param {ExecutionContext} ctx
   * @returns {Promise<Response>}
   */
  fetch: async (request, env, ctx) => {
    const url = new URL(request.url);
    const pathname = url.pathname;

    try {
      // Handle root path - landing page
      if (pathname === "/") {
        return new Response(getLandingPageHTML(), {
          headers: { "Content-Type": "text/html" },
        });
      }

      if (pathname === "/.well-known/stripeflare.json") {
        return new Response(JSON.stringify({ username: "janwilmake" }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Handle OAuth callback
      if (pathname === "/callback" && url.searchParams.has("code")) {
        return handleOAuthCallback(request, env, url);
      }

      // Handle dashboard
      if (pathname === "/dashboard") {
        return handleDashboard(request, env);
      }

      // Handle webhook
      if (pathname.startsWith("/stripeflare/")) {
        return handleWebhook(request, env, ctx);
      }

      // Handle user markdown endpoint
      if (pathname.startsWith("/") && pathname.length > 1) {
        const username = pathname.slice(1);
        return handleUserMarkdown(env, username);
      }

      return new Response("Not Found", { status: 404 });
    } catch (error) {
      console.error("Error:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
};

/**
 * Handle OAuth callback from X Money
 * @param {Request} request
 * @param {Env} env
 * @param {URL} url
 * @returns {Promise<Response>}
 */
async function handleOAuthCallback(request, env, url) {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code) {
    return new Response("Missing authorization code", { status: 400 });
  }

  try {
    // Exchange code for access token
    const tokenResponse = await fetch("https://x.stripeflare.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code,
        client_id: "xfollows.markdownfeed.com",
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenData.access_token) {
      return new Response("Failed to get access token", { status: 400 });
    }

    // Set cookie and redirect to dashboard
    const headers = new Headers();
    const cookieValue = `access_token=${
      tokenData.access_token
    }; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${90 * 24 * 60 * 60}`;
    headers.append("Set-Cookie", cookieValue);
    headers.set("Location", "/dashboard");

    return new Response(null, {
      status: 302,
      headers,
    });
  } catch (error) {
    console.error("OAuth callback error:", error);
    return new Response("OAuth callback failed", { status: 500 });
  }
}

/**
 * Handle dashboard page
 * @param {Request} request
 * @param {Env} env
 * @returns {Promise<Response>}
 */
async function handleDashboard(request, env) {
  const accessToken = getAccessToken(request);

  if (!accessToken) {
    return new Response(getLoginRedirectHTML(), {
      headers: { "Content-Type": "text/html" },
    });
  }

  try {
    // Get user info
    const userResponse = await fetch("https://x.stripeflare.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const userData = await userResponse.json();

    if (!userData.username) {
      return new Response("Failed to get user info", { status: 400 });
    }

    return new Response(getDashboardHTML(userData, accessToken), {
      headers: { "Content-Type": "text/html" },
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    return new Response("Dashboard error", { status: 500 });
  }
}

/**
 * Handle webhook from X Money
 * @param {Request} request
 * @param {Env} env
 * @param {ExecutionContext} ctx
 * @returns {Promise<Response>}
 */
async function handleWebhook(request, env, ctx) {
  const url = new URL(request.url);
  const pathParts = url.pathname.split("/");

  if (pathParts.length < 3) {
    return new Response("Invalid webhook path", { status: 400 });
  }

  const username = pathParts[2];
  const metadata = pathParts[3] || "";

  const accessToken = getAccessToken(request);

  if (!accessToken) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    // Verify user has sufficient balance
    const userResponse = await fetch("https://x.stripeflare.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const userData = await userResponse.json();

    if (!userData.client_balance || userData.client_balance < 20) {
      return new Response("Insufficient balance", { status: 400 });
    }

    // Set loading state
    await env.KV_NAMESPACE.put(`/${username}`, "loading...");

    // Process following list in background
    ctx.waitUntil(processUserFollowing(username, accessToken, env));

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response("Webhook error", { status: 500 });
  }
}

/**
 * Handle user markdown endpoint
 * @param {Env} env
 * @param {string} username
 * @returns {Promise<Response>}
 */
async function handleUserMarkdown(env, username) {
  try {
    const markdown = await env.KV_NAMESPACE.get(`/${username}`);

    if (!markdown) {
      return new Response("User not found", { status: 404 });
    }

    return new Response(markdown, {
      headers: { "Content-Type": "text/markdown" },
    });
  } catch (error) {
    console.error("User markdown error:", error);
    return new Response("Error retrieving markdown", { status: 500 });
  }
}

/**
 * Process user following list and convert to markdown
 * @param {string} username
 * @param {string} accessToken
 * @param {Env} env
 * @returns {Promise<void>}
 */
async function processUserFollowing(username, accessToken, env) {
  try {
    // Charge $20 from user's balance
    const chargeResponse = await fetch("https://x.stripeflare.com/charge", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount_usd: 20.0,
        detail: "XFollows markdown generation",
      }),
    });

    if (!chargeResponse.ok) {
      throw new Error("Failed to charge user");
    }

    // Get all following users
    const followingUsers = await getAllFollowing(env, username);

    // Convert to markdown
    const markdown = convertToMarkdown(username, followingUsers);

    // Store in KV
    await env.KV_NAMESPACE.put(`/${username}`, markdown);

    console.log(
      `Successfully processed ${followingUsers.length} following users for ${username}`,
    );
  } catch (error) {
    console.error("Error processing user following:", error);
    // Store error message instead
    await env.KV_NAMESPACE.put(`/${username}`, `Error: ${error.message}`);
  }
}

/**
 * Get all users that a user is following
 * @param {Env} env
 * @param {string} username
 * @returns {Promise<UserInfo[]>}
 */
async function getAllFollowing(env, username) {
  const allFollowing = [];
  let cursor = "";
  let hasNextPage = true;

  while (hasNextPage) {
    const url = `https://api.twitterapi.io/twitter/user/followings?userName=${username}${
      cursor ? `&cursor=${cursor}` : ""
    }`;

    const response = await fetch(url, {
      headers: {
        "X-API-Key": env.TWITTER_API_KEY || "your-api-key-here",
      },
    });

    if (!response.ok) {
      throw new Error(`TwitterAPI request failed: ${response.status}`);
    }

    /** @type {FollowingsResponse} */
    const data = await response.json();

    if (data.status !== "success") {
      throw new Error(`TwitterAPI error: ${data.message}`);
    }

    allFollowing.push(...data.followings);
    hasNextPage = data.has_next_page;
    cursor = data.next_cursor;

    // Add small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return allFollowing;
}

/**
 * Convert following users to markdown format
 * @param {string} username
 * @param {UserInfo[]} followingUsers
 * @returns {string}
 */
function convertToMarkdown(username, followingUsers) {
  const timestamp = new Date().toISOString();

  let markdown = `# ${username}'s Following List\n\n`;
  markdown += `Generated on: ${timestamp}\n`;
  markdown += `Total following: ${followingUsers.length}\n\n`;

  // Sort by followers count (descending)
  followingUsers.sort((a, b) => b.followers - a.followers);

  followingUsers.forEach((user) => {
    markdown += `## [@${user.userName}](https://x.com/${user.userName})\n\n`;
    markdown += `**${user.name}**${user.isBlueVerified ? " ✓" : ""}\n\n`;

    if (user.description) {
      markdown += `${user.description}\n\n`;
    }

    markdown += `- **Followers:** ${user.followers?.toLocaleString()}\n`;
    markdown += `- **Following:** ${user.following?.toLocaleString()}\n`;
    markdown += `- **Posts:** ${user.statusesCount?.toLocaleString()}\n`;

    if (user.location) {
      markdown += `- **Location:** ${user.location}\n`;
    }

    markdown += `- **Joined:** ${new Date(
      user.createdAt,
    )?.toLocaleDateString()}\n\n`;
    markdown += `---\n\n`;
  });

  return markdown;
}

/**
 * Extract access token from request (cookie or Authorization header)
 * @param {Request} request
 * @returns {string|null}
 */
function getAccessToken(request) {
  // Check Authorization header first
  const authHeader = request.headers.get("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }

  // Check cookie
  const cookie = request.headers.get("Cookie");
  if (cookie) {
    const match = cookie.match(/access_token=([^;]+)/);
    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * Get landing page HTML
 * @returns {string}
 */
function getLandingPageHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>XFollows - Your Twitter Following as Markdown</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            margin: 0;
            padding: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .container {
            max-width: 600px;
            padding: 2rem;
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            text-align: center;
        }
        h1 {
            color: #333;
            margin-bottom: 1rem;
            font-size: 2.5rem;
        }
        .subtitle {
            color: #666;
            font-size: 1.2rem;
            margin-bottom: 2rem;
        }
        .btn {
            background: #1da1f2;
            color: white;
            padding: 1rem 2rem;
            border: none;
            border-radius: 50px;
            font-size: 1.1rem;
            cursor: pointer;
            transition: all 0.3s ease;
            text-decoration: none;
            display: inline-block;
        }
        .btn:hover {
            background: #1991da;
            transform: translateY(-2px);
        }
        .features {
            margin-top: 3rem;
            text-align: left;
        }
        .feature {
            margin: 1rem 0;
            padding: 1rem;
            background: #f8f9fa;
            border-radius: 10px;
        }
        .price {
            font-size: 1.5rem;
            color: #28a745;
            font-weight: bold;
            margin: 1rem 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🐦 XFollows</h1>
        <p class="subtitle">Get your Twitter following list as beautiful markdown</p>
        
        <div class="price">Only $20 per export</div>
        
        <a href="https://x.stripeflare.com/authorize?client_id=xfollows.markdownfeed.com&redirect_uri=https://xfollows.markdownfeed.com/callback&state=auth" class="btn">
            Login with X Money
        </a>
        
        <div class="features">
            <div class="feature">
                <h3>📊 Complete Export</h3>
                <p>Get all users you follow with their bio, follower count, and join date</p>
            </div>
            <div class="feature">
                <h3>📝 Markdown Format</h3>
                <p>Clean, readable markdown that you can use anywhere</p>
            </div>
            <div class="feature">
                <h3>🔗 Permanent Link</h3>
                <p>Access your export anytime at /your-username</p>
            </div>
        </div>
    </div>
</body>
</html>`;
}

/**
 * Get login redirect HTML
 * @returns {string}
 */
function getLoginRedirectHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login Required - XFollows</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            margin: 0;
            padding: 2rem;
            background: #f8f9fa;
            text-align: center;
        }
        .container {
            max-width: 400px;
            margin: 0 auto;
            padding: 2rem;
            background: white;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .btn {
            background: #1da1f2;
            color: white;
            padding: 1rem 2rem;
            border: none;
            border-radius: 50px;
            text-decoration: none;
            display: inline-block;
            margin-top: 1rem;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Login Required</h1>
        <p>Please login to access your dashboard</p>
        <a href="https://x.stripeflare.com/authorize?client_id=xfollows.markdownfeed.com&redirect_uri=https://xfollows.markdownfeed.com/callback&state=auth" class="btn">
            Login with X Money
        </a>
    </div>
</body>
</html>`;
}

/**
 * Get dashboard HTML
 * @param {Object} userData
 * @param {string} accessToken
 * @returns {string}
 */
function getDashboardHTML(userData, accessToken) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dashboard - XFollows</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            margin: 0;
            padding: 2rem;
            background: #f8f9fa;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            padding: 2rem;
            background: white;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .profile {
            display: flex;
            align-items: center;
            margin-bottom: 2rem;
        }
        .profile img {
            width: 60px;
            height: 60px;
            border-radius: 50%;
            margin-right: 1rem;
        }
        .balance {
            background: #e8f5e8;
            padding: 1rem;
            border-radius: 5px;
            margin: 1rem 0;
        }
        .code-block {
            background: #2d3748;
            color: #e2e8f0;
            padding: 1rem;
            border-radius: 5px;
            font-family: 'Courier New', monospace;
            overflow-x: auto;
            margin: 1rem 0;
        }
        .btn {
            background: #28a745;
            color: white;
            padding: 1rem 2rem;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 1rem;
            margin: 1rem 0;
        }
        .btn:hover {
            background: #218838;
        }
        .warning {
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            padding: 1rem;
            border-radius: 5px;
            margin: 1rem 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="profile">
            <img src="${userData.profile_image_url}" alt="${userData.name}">
            <div>
                <h1>${userData.name} (@${userData.username})</h1>
                <p>Welcome to your XFollows dashboard</p>
            </div>
        </div>
        
        <div class="balance">
            <h3>Account Balance</h3>
            <p><strong>Total Balance:</strong> $${userData.balance.toFixed(
              2,
            )}</p>
            <p><strong>Available for XFollows:</strong> $${userData.client_balance.toFixed(
              2,
            )}</p>
        </div>
        
        ${
          userData.client_balance >= 20
            ? `
        <div>
            <h3>🎉 Ready to Export!</h3>
            <p>You have sufficient balance to export your following list.</p>
            <a href="https://x.stripeflare.com/deposit/${userData.username}/xfollows.markdownfeed.com?message=XFollows%20Export&amount_usd=20.00&metadata=export" class="btn">
                Pay $20 & Generate Export
            </a>
        </div>
        `
            : `
        <div class="warning">
            <h3>⚠️ Insufficient Balance</h3>
            <p>You need at least $20 to export your following list. Please add funds to your account.</p>
            <a href="https://x.stripeflare.com/deposit/${userData.username}/xfollows.markdownfeed.com?message=XFollows%20Fund%20Account&amount_usd=20.00" class="btn">
                Add $20 to Account
            </a>
        </div>
        `
        }
        
        <div>
            <h3>API Access</h3>
            <p>You can also access your markdown export programmatically:</p>
            <div class="code-block">
curl -H "Authorization: Bearer ${accessToken}" \\
     https://xfollows.markdownfeed.com/${userData.username}
            </div>
            <p>Or directly at: <a href="/${
              userData.username
            }">https://xfollows.markdownfeed.com/${userData.username}</a></p>
        </div>
    </div>
</body>
</html>`;
}
