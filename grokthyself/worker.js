import { withSimplerAuth } from "simplerauth-client";
import loginPage from "./login-template.html";

const dashboardPage = (user) => `<!DOCTYPE html>
<html lang="en" class="bg-amber-50">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dashboard - Grok Thyself</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        @import url("https://fonts.googleapis.com/css2?family=Crimson+Text:wght@400;600;700&family=Trajan+Pro:wght@400;700&display=swap");

        body {
            font-family: "Crimson Text", serif;
            background-color: #f5e6d3;
            background-image: 
                radial-gradient(circle at 25% 25%, rgba(139, 69, 19, 0.1) 0%, transparent 50%),
                radial-gradient(circle at 75% 75%, rgba(160, 82, 45, 0.1) 0%, transparent 50%),
                linear-gradient(90deg, rgba(210, 180, 140, 0.1) 1px, transparent 1px),
                linear-gradient(rgba(210, 180, 140, 0.1) 1px, transparent 1px);
            background-size: 
                200px 200px,
                200px 200px,
                20px 20px,
                20px 20px;
        }

        .latin-title {
            font-family: "Trajan Pro", "Crimson Text", serif;
            font-size: clamp(2rem, 6vw, 3rem);
            line-height: 1;
            font-weight: 700;
            letter-spacing: 0.1em;
            text-shadow: 2px 2px 4px rgba(139, 69, 19, 0.3);
            color: #8b4513;
        }

        .papyrus-card {
            background: rgba(255, 255, 255, 0.4);
            border: 2px solid #8b4513;
            border-radius: 1rem;
            box-shadow: 0 4px 15px rgba(139, 69, 19, 0.2);
        }

        .papyrus-button {
            background: linear-gradient(145deg, #deb887, #d2b48c);
            box-shadow: 
                inset 0 1px 0 rgba(255, 255, 255, 0.4),
                inset 0 -1px 0 rgba(0, 0, 0, 0.1),
                0 4px 12px rgba(139, 69, 19, 0.3);
            border: 2px solid #8b4513;
            color: #654321;
            font-weight: 600;
            padding: 0.75rem 1.5rem;
            border-radius: 0.5rem;
            transition: all 0.3s ease;
        }

        .papyrus-button:hover {
            background: linear-gradient(145deg, #d2b48c, #deb887);
            transform: translateY(-1px);
        }
    </style>
</head>
<body class="text-amber-900">
    <main class="min-h-screen px-4 py-8">
        <div class="max-w-4xl mx-auto">
            <!-- Header -->
            <div class="text-center mb-12">
                <h1 class="latin-title mb-4">GROK THYSELF</h1>
                <p class="text-xl text-amber-700">Nosce te ipsum per verba tua</p>
            </div>

            <!-- User Info Card -->
            <div class="papyrus-card p-8 mb-8">
                <div class="flex items-center gap-4 mb-6">
                    ${
                      user.profile_image_url
                        ? `<img src="${user.profile_image_url}" alt="Profile" class="w-16 h-16 rounded-full border-2 border-amber-700">`
                        : ""
                    }
                    <div>
                        <h2 class="text-2xl font-bold text-amber-800">${
                          user.name
                        }</h2>
                        <p class="text-amber-600">@${user.username}</p>
                    </div>
                </div>
                
                <div class="grid md:grid-cols-2 gap-6">
                    <div>
                        <h3 class="text-lg font-semibold mb-3 text-amber-800">Your Digital Self</h3>
                        <p class="text-amber-700 mb-4">
                            Your X content has been processed and is ready for AI analysis. 
                            Others can now chat with your digital self at:
                        </p>
                        <div class="bg-amber-100 border border-amber-300 rounded-lg p-3">
                            <code class="text-amber-800">https://grokthyself.com/${
                              user.username
                            }</code>
                        </div>
                    </div>
                    
                    <div>
                        <h3 class="text-lg font-semibold mb-3 text-amber-800">Actions</h3>
                        <div class="space-y-3">
                            <a href="/${
                              user.username
                            }" target="_blank" class="papyrus-button block text-center">
                                Chat with Your Digital Self
                            </a>
                            <button class="papyrus-button w-full" onclick="refreshData()">
                                Refresh X Data
                            </button>
                            <a href="/logout" class="papyrus-button block text-center bg-red-200 hover:bg-red-300">
                                Logout
                            </a>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Stats Card -->
            <div class="papyrus-card p-6">
                <h3 class="text-lg font-semibold mb-4 text-amber-800">Statistics</h3>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                    <div>
                        <div class="text-2xl font-bold text-amber-700">${
                          user.usage || 0
                        }</div>
                        <div class="text-sm text-amber-600">API Calls</div>
                    </div>
                    <div>
                        <div class="text-2xl font-bold text-amber-700">${
                          user.balance || "∞"
                        }</div>
                        <div class="text-sm text-amber-600">Credits</div>
                    </div>
                    <div>
                        <div class="text-2xl font-bold text-amber-700">Active</div>
                        <div class="text-sm text-amber-600">Status</div>
                    </div>
                    <div>
                        <div class="text-2xl font-bold text-amber-700">Public</div>
                        <div class="text-sm text-amber-600">Visibility</div>
                    </div>
                </div>
            </div>
        </div>
    </main>

    <script>
        function refreshData() {
            // In a real app, this would trigger a background job to refresh X data
            alert('X data refresh initiated! This may take a few minutes.');
        }
    </script>
</body>
</html>`;

export default {
  fetch: withSimplerAuth(
    async (request, env, ctx) => {
      const url = new URL(request.url);

      // Handle login page
      if (url.pathname === "/login") {
        if (ctx.authenticated) {
          // Redirect to dashboard if already logged in
          return Response.redirect(url.origin + "/dashboard", 302);
        }
        return new Response(loginPage, {
          headers: { "Content-Type": "text/html" },
        });
      }

      // Handle dashboard page
      if (url.pathname === "/dashboard") {
        if (!ctx.authenticated) {
          // Redirect to login if not authenticated
          return Response.redirect(url.origin + "/login", 302);
        }
        return new Response(dashboardPage(ctx.user), {
          headers: { "Content-Type": "text/html" },
        });
      }

      // Default redirect to login
      return Response.redirect(url.origin + "/login", 302);
    },
    {
      isLoginRequired: false,
      scope: "profile",
    }
  ),
};
