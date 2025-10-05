/// <reference types="@cloudflare/workers-types" />
/// <reference lib="esnext" />

import { DurableObject } from "cloudflare:workers";
import { UserContext, withSimplerAuth } from "simplerauth-client";
//@ts-ignore
import loginPage from "./login-template.html";

const DO_NAME_PREFIX = "v1:";
export interface Env {
  USER_DO: DurableObjectNamespace<UserDO>;
  X_API_KEY: string;
}

interface User extends Record<string, any> {
  id: string;
  username: string;
  is_premium: number;
  balance: number;
  initialized: number;
  created_at: string;
}

interface Post extends Record<string, any> {
  id: string;
  user_id: string;
  tweet_id: string;
  text: string;
  author_username: string;
  author_name: string;
  created_at: string;
  like_count: number;
  retweet_count: number;
  reply_count: number;
  is_reply: number;
  conversation_id: string;
  raw_data: string;
}

const dashboardPage = (user: any, stats: any) => `<!DOCTYPE html>
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

        .loading {
            opacity: 0.6;
            pointer-events: none;
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
                        ${
                          stats.isPremium
                            ? '<span class="inline-block bg-amber-200 text-amber-800 px-2 py-1 rounded-full text-sm font-semibold">Premium</span>'
                            : ""
                        }
                    </div>
                </div>
                
                <div class="grid md:grid-cols-2 gap-6">
                    <div>
                        <h3 class="text-lg font-semibold mb-3 text-amber-800">Your Digital Self</h3>
                        <p class="text-amber-700 mb-4">
                            ${
                              stats.initialized
                                ? "Your X content has been processed and is ready for AI analysis."
                                : "Initializing your digital self... This may take a few minutes."
                            }
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
                            }" target="_blank" class="papyrus-button block text-center ${
  !stats.initialized ? "opacity-50 pointer-events-none" : ""
}">
                                Chat with Your Digital Self
                            </a>
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
                          stats.postCount
                        }</div>
                        <div class="text-sm text-amber-600">Posts Analyzed</div>
                    </div>
                    <div>
                        <div class="text-2xl font-bold text-amber-700">${
                          stats.balance
                        }</div>
                        <div class="text-sm text-amber-600">Credits</div>
                    </div>
                    <div>
                        <div class="text-2xl font-bold text-amber-700">${
                          stats.initialized ? "Active" : "Initializing"
                        }</div>
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
</body>
</html>`;

export class UserDO extends DurableObject<Env> {
  private sql: SqlStorage;

  get = (name: string) =>
    this.env.USER_DO.get(this.env.USER_DO.idFromName(name));

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.sql = state.storage.sql;
    this.env = env;
    this.initializeTables();
  }

  private initializeTables() {
    // Create users table
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        is_premium INTEGER DEFAULT 0,
        balance INTEGER DEFAULT 0,
        initialized INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create posts table
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        tweet_id TEXT UNIQUE NOT NULL,
        text TEXT,
        author_username TEXT,
        author_name TEXT,
        created_at TEXT,
        like_count INTEGER DEFAULT 0,
        retweet_count INTEGER DEFAULT 0,
        reply_count INTEGER DEFAULT 0,
        is_reply INTEGER DEFAULT 0,
        conversation_id TEXT,
        raw_data TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )
    `);

    // Create indexes
    this.sql.exec(
      `CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts (user_id)`
    );
    this.sql.exec(
      `CREATE INDEX IF NOT EXISTS idx_posts_tweet_id ON posts (tweet_id)`
    );
  }

  async initializeUser(authUser: UserContext["user"]): Promise<void> {
    // Insert user if not exists
    const existingUser = this.sql
      .exec(`SELECT * FROM users WHERE id = ?`, authUser.id)
      .toArray();

    if (existingUser.length === 0) {
      this.sql.exec(
        `INSERT INTO users (id, username) VALUES (?, ?)`,
        authUser.id,
        authUser.username
      );
    }

    // Check if already initialized
    const user = this.sql
      .exec<User>(`SELECT initialized FROM users WHERE id = ?`, authUser.id)
      .toArray()[0];

    if (!user.initialized) {
      // Start initialization process
      await this.performInitialScrape(authUser.id, authUser?.username);

      // Mark as initialized
      this.sql.exec(
        `UPDATE users SET initialized = 1 WHERE id = ?`,
        authUser.id
      );
    }
  }

  private async performInitialScrape(
    userId: string,
    username: string
  ): Promise<void> {
    try {
      console.log(`Starting initial scrape for user ${username}`);

      // Get user's recent posts
      const postsResponse = await this.fetchUserPosts(username);

      if (postsResponse.status === "success" && postsResponse.tweets) {
        // Store posts and get comments for each
        for (const tweet of postsResponse.tweets) {
          await this.storePost(userId, tweet);

          // Get thread context (comments) for each post
          try {
            const threadResponse = await this.fetchThreadContext(tweet.id);
            if (threadResponse.status === "success" && threadResponse.replies) {
              for (const reply of threadResponse.replies) {
                await this.storePost(userId, reply);
              }
            }
          } catch (error) {
            console.error(
              `Failed to fetch thread for tweet ${tweet.id}:`,
              error
            );
          }
        }
      }

      console.log(`Completed initial scrape for user ${username}`);
    } catch (error) {
      console.error(`Initial scrape failed for user ${username}:`, error);
      throw error;
    }
  }

  private async fetchUserPosts(username: string) {
    const response = await fetch(
      `https://api.twitterapi.io/twitter/user/last_tweets?userName=${username}`,
      {
        headers: {
          "X-API-Key": this.env.X_API_KEY,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch posts: ${response.status}`);
    }

    return (await response.json()) as any;
  }

  private async fetchThreadContext(tweetId: string) {
    const response = await fetch(
      `https://api.twitterapi.io/twitter/tweet/thread_context?tweetId=${tweetId}`,
      {
        headers: {
          "X-API-Key": this.env.X_API_KEY,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch thread: ${response.status}`);
    }

    return (await response.json()) as any;
  }

  private async storePost(userId: string, tweet: any): Promise<void> {
    try {
      this.sql.exec(
        `INSERT OR REPLACE INTO posts (
          user_id, tweet_id, text, author_username, author_name,
          created_at, like_count, retweet_count, reply_count,
          is_reply, conversation_id, raw_data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        userId,
        tweet.id,
        tweet.text || "",
        tweet.author?.userName || "",
        tweet.author?.name || "",
        tweet.createdAt || "",
        tweet.likeCount || 0,
        tweet.retweetCount || 0,
        tweet.replyCount || 0,
        tweet.isReply ? 1 : 0,
        tweet.conversationId || "",
        JSON.stringify(tweet)
      );
    } catch (error) {
      console.error("Failed to store post:", error);
    }
  }

  async getPosts(
    username: string
  ): Promise<{ user: User; posts: Post[]; stats: any }> {
    // Get user info
    const userResult = this.sql
      .exec(`SELECT * FROM users WHERE username = ?`, username)
      .toArray();

    if (userResult.length === 0) {
      throw new Error("User not found");
    }

    const user = userResult[0] as User;

    // Get posts
    const postsResult = this.sql
      .exec<Post>(
        `SELECT * FROM posts WHERE user_id = ? ORDER BY created_at DESC`,
        user.id
      )
      .toArray();

    // Calculate stats
    const stats = {
      postCount: postsResult.length,
      balance: user.balance,
      isPremium: Boolean(user.is_premium),
      initialized: Boolean(user.initialized),
    };

    return { user, posts: postsResult, stats };
  }

  async getUserStats(authUser: UserContext["user"]): Promise<any> {
    await this.initializeUser(authUser);

    const userResult = this.sql
      .exec(`SELECT * FROM users WHERE id = ?`, authUser.id)
      .toArray();

    if (userResult.length === 0) {
      return null;
    }

    const user = userResult[0] as User;

    const postCount = this.sql
      .exec(
        `SELECT COUNT(*) as count FROM posts WHERE user_id = ?`,
        authUser.id
      )
      .toArray()[0] as { count: number };

    return {
      postCount: postCount.count,
      balance: user.balance,
      isPremium: Boolean(user.is_premium),
      initialized: Boolean(user.initialized),
    };
  }
}

export default {
  fetch: withSimplerAuth(
    async (request: Request, env: Env, ctx: UserContext) => {
      // Ensure required environment variables are present
      if (!env.X_API_KEY) {
        return new Response("X_API_KEY environment variable is required", {
          status: 500,
        });
      }

      const url = new URL(request.url);

      // Handle login page
      if (url.pathname === "/login") {
        if (ctx.authenticated) {
          return Response.redirect(url.origin + "/dashboard", 302);
        }
        return new Response(loginPage, {
          headers: { "Content-Type": "text/html" },
        });
      }

      // Handle dashboard page
      if (url.pathname === "/dashboard") {
        if (!ctx.authenticated) {
          return Response.redirect(url.origin + "/login", 302);
        }

        try {
          // Get user's Durable Object
          const userDO = env.USER_DO.get(
            env.USER_DO.idFromName(DO_NAME_PREFIX + ctx.user.id)
          );

          // Get user stats
          const stats = await userDO.getUserStats(ctx.user);

          return new Response(dashboardPage(ctx.user, stats), {
            headers: { "Content-Type": "text/html" },
          });
        } catch (error) {
          console.error("Dashboard error:", error);
          return new Response("Error loading dashboard", { status: 500 });
        }
      }

      if (url.pathname === "/posts") {
        if (!ctx.authenticated) {
          return Response.redirect(url.origin + "/login", 302);
        }

        try {
          // Get user's Durable Object
          const userDO = env.USER_DO.get(
            env.USER_DO.idFromName(DO_NAME_PREFIX + ctx.user.id)
          );

          // Get user stats
          const data = await userDO.getPosts(ctx.user.username);

          return new Response(JSON.stringify(data, undefined, 2), {
            headers: { "Content-Type": "application/json;charset=utf8" },
          });
        } catch (error) {
          console.error("Dashboard error:", error);
          return new Response("Error loading dashboard", { status: 500 });
        }
      }

      // Default redirect to login
      return Response.redirect(url.origin + "/login", 302);
    },
    {
      isLoginRequired: false,
      scope: "profile",
    }
  ),
} satisfies ExportedHandler<Env>;
