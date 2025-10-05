/// <reference types="@cloudflare/workers-types" />
/// <reference lib="esnext" />

import { DurableObject } from "cloudflare:workers";
import { UserContext, withSimplerAuth } from "simplerauth-client";
import { Queryable, studioMiddleware } from "queryable-object";
//@ts-ignore
import loginPage from "./login-template.html";

const DO_NAME_PREFIX = "v3:";

export interface Env {
  USER_DO: DurableObjectNamespace<UserDO>;
  X_API_KEY: string;
}

// API Response Types based on OpenAPI spec
interface Tweet {
  type: "tweet";
  id: string;
  url: string;
  text: string;
  source: string;
  retweetCount: number;
  replyCount: number;
  likeCount: number;
  quoteCount: number;
  viewCount?: number;
  createdAt: string;
  lang?: string;
  bookmarkCount?: number;
  isReply: boolean;
  inReplyToId?: string;
  conversationId?: string;
  inReplyToUserId?: string;
  inReplyToUsername?: string;
  author: UserInfo;
  entities?: TweetEntities;
  quoted_tweet?: Tweet;
  retweeted_tweet?: Tweet;
}

interface UserInfo {
  type: "user";
  userName: string;
  url: string;
  id: string;
  name: string;
  isBlueVerified: boolean;
  verifiedType?: string;
  profilePicture: string;
  coverPicture?: string;
  description?: string;
  location?: string;
  followers: number;
  following: number;
  canDm: boolean;
  createdAt: string;
  favouritesCount: number;
  statusesCount: number;
}

interface TweetEntities {
  hashtags?: Array<{
    indices: number[];
    text: string;
  }>;
  urls?: Array<{
    display_url: string;
    expanded_url: string;
    indices: number[];
    url: string;
  }>;
  user_mentions?: Array<{
    id_str: string;
    name: string;
    screen_name: string;
  }>;
}

interface TwitterAPIResponse {
  data: { tweets: Tweet[] };
  has_next_page: boolean;
  next_cursor: string;
  msg: "success" | "error";
  message: string;
}

interface ThreadContextResponse {
  replies: Tweet[];
  has_next_page: boolean;
  next_cursor: string;
  status: "success" | "error";
  message: string;
}

// Database Types
interface User extends Record<string, any> {
  id: string;
  username: string;
  is_premium: number;
  balance: number;
  initialized: number;
  scrape_status: "pending" | "in_progress" | "completed" | "failed";
  created_at: string;
  updated_at: string;
}

interface Post extends Record<string, any> {
  id: number;
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

interface UserStats {
  postCount: number;
  balance: number;
  isPremium: boolean;
  initialized: boolean;
  scrapeStatus: "pending" | "in_progress" | "completed" | "failed";
  posts?: Post[];
}

const dashboardPage = (user: any, stats: UserStats) => `<!DOCTYPE html>
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

        .post-card {
            background: rgba(255, 255, 255, 0.6);
            border: 1px solid #d2b48c;
            border-radius: 0.5rem;
            padding: 1rem;
            margin-bottom: 0.75rem;
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
                              stats.scrapeStatus === "completed"
                                ? "Your X content has been processed and is ready for AI analysis."
                                : stats.scrapeStatus === "in_progress"
                                ? "Processing your X content... This may take a few minutes."
                                : stats.scrapeStatus === "failed"
                                ? "Failed to process your content. Please refresh to retry."
                                : "Initializing your digital self..."
                            }
                        </p>

                    </div>
                    
                    <div>
                        <h3 class="text-lg font-semibold mb-3 text-amber-800">Actions</h3>
                        <div class="space-y-3">
                            <a href="/admin" target="_blank" class="papyrus-button block text-center ${
                              stats.scrapeStatus !== "completed"
                                ? "opacity-50 pointer-events-none"
                                : ""
                            }">
                                Admin Panel
                            </a>
                            <a href="/logout" class="papyrus-button block text-center bg-red-200 hover:bg-red-300">
                                Logout
                            </a>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Stats Card -->
            <div class="papyrus-card p-6 mb-8">
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
                          stats.scrapeStatus === "completed"
                            ? "Active"
                            : stats.scrapeStatus === "in_progress"
                            ? "Processing"
                            : stats.scrapeStatus === "failed"
                            ? "Failed"
                            : "Pending"
                        }</div>
                        <div class="text-sm text-amber-600">Status</div>
                    </div>
                    <div>
                        <div class="text-2xl font-bold text-amber-700">Public</div>
                        <div class="text-sm text-amber-600">Visibility</div>
                    </div>
                </div>
            </div>

            ${
              stats.posts && stats.posts.length > 0
                ? `
            <!-- Posts Preview -->
            <div class="papyrus-card p-6">
                <h3 class="text-lg font-semibold mb-4 text-amber-800">Recent Posts Preview</h3>
                <div class="max-h-96 overflow-y-auto">
                    ${stats.posts
                      .slice(0, 10)
                      .map(
                        (post) => `
                    <div class="post-card">
                        <div class="flex justify-between items-start mb-2">
                            <span class="text-sm text-amber-600">@${
                              post.author_username
                            }</span>
                            <span class="text-xs text-amber-500">${new Date(
                              post.created_at
                            ).toLocaleDateString()}</span>
                        </div>
                        <p class="text-amber-800 mb-2">${post.text}</p>
                        <div class="flex gap-4 text-xs text-amber-600">
                            <span>❤️ ${post.like_count}</span>
                            <span>🔄 ${post.retweet_count}</span>
                            <span>💬 ${post.reply_count}</span>
                        </div>
                    </div>
                    `
                      )
                      .join("")}
                    ${
                      stats.postCount > 10
                        ? `<p class="text-center text-amber-600 mt-4">... and ${
                            stats.postCount - 10
                          } more posts</p>`
                        : ""
                    }
                </div>
            </div>
            `
                : ""
            }
        </div>
    </main>
</body>
</html>`;

@Queryable()
export class UserDO extends DurableObject<Env> {
  private sql: SqlStorage;

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
        scrape_status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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

  async ensureUserExists(authUser: UserContext["user"]): Promise<User> {
    // Insert user if not exists
    const existingUserResult = this.sql
      .exec(`SELECT * FROM users WHERE id = ?`, authUser.id)
      .toArray();

    if (existingUserResult.length === 0) {
      this.sql.exec(
        `INSERT INTO users (id, username) VALUES (?, ?)`,
        authUser.id,
        authUser.username
      );
    }

    // Get current user state
    const userResult = this.sql
      .exec<User>(`SELECT * FROM users WHERE id = ?`, authUser.id)
      .toArray();

    const user = userResult[0];

    // Start background scraping if not started
    if (user.scrape_status === "pending") {
      console.log(`Starting background scrape for user ${authUser.username}`);
      this.sql.exec(
        `UPDATE users SET scrape_status = 'in_progress', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        authUser.id
      );

      // Start background task
      this.ctx.waitUntil(
        this.performBackgroundScrape(authUser.id, authUser.username)
      );
    }

    return user;
  }

  private async performBackgroundScrape(
    userId: string,
    username: string
  ): Promise<void> {
    try {
      console.log(
        `Starting background scrape for user ${username} (${userId})`
      );

      // Get user's recent posts
      const postsResponse = await this.fetchUserPosts(username);
      console.log(
        `Posts API response status: ${postsResponse.msg}`,
        postsResponse
      );

      if (
        postsResponse.msg === "success" &&
        postsResponse.data?.tweets?.length > 0
      ) {
        console.log(
          `Found ${postsResponse.data.tweets.length} tweets for ${username}`
        );

        // Store posts and get comments for each
        for (const tweet of postsResponse.data.tweets) {
          try {
            await this.storePost(userId, tweet);
            console.log(`Stored tweet ${tweet.id}`);

            // Get thread context (comments) for each post
            try {
              const threadResponse = await this.fetchThreadContext(tweet.id);
              console.log(
                `Thread API response for ${tweet.id}:`,
                threadResponse.status
              );

              if (
                threadResponse.status === "success" &&
                threadResponse.replies &&
                threadResponse.replies.length > 0
              ) {
                console.log(
                  `Found ${threadResponse.replies.length} replies for tweet ${tweet.id}`
                );
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
          } catch (error) {
            console.error(`Failed to process tweet ${tweet.id}:`, error);
          }
        }

        // Mark as completed and initialized
        this.sql.exec(
          `UPDATE users SET scrape_status = 'completed', initialized = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          userId
        );

        console.log(`Completed background scrape for user ${username}`);
      } else {
        console.error(
          `No tweets found for user ${username}. API Response:`,
          postsResponse
        );

        // Mark as failed
        this.sql.exec(
          `UPDATE users SET scrape_status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          userId
        );
      }
    } catch (error) {
      console.error(`Background scrape failed for user ${username}:`, error);

      // Mark as failed
      this.sql.exec(
        `UPDATE users SET scrape_status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        userId
      );
    }
  }

  private async fetchUserPosts(username: string): Promise<TwitterAPIResponse> {
    const url = `https://api.twitterapi.io/twitter/user/last_tweets?userName=${username}`;
    console.log(`Fetching user posts from: ${url}`);

    const response = await fetch(url, {
      headers: {
        "X-API-Key": this.env.X_API_KEY,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `Failed to fetch posts: ${response.status} ${response.statusText}`,
        errorText
      );
      throw new Error(
        `Failed to fetch posts: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as TwitterAPIResponse;
    return data;
  }

  private async fetchThreadContext(
    tweetId: string
  ): Promise<ThreadContextResponse> {
    const url = `https://api.twitterapi.io/twitter/tweet/thread_context?tweetId=${tweetId}`;
    console.log(`Fetching thread context from: ${url}`);

    const response = await fetch(url, {
      headers: {
        "X-API-Key": this.env.X_API_KEY,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `Failed to fetch thread: ${response.status} ${response.statusText}`,
        errorText
      );
      throw new Error(
        `Failed to fetch thread: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as ThreadContextResponse;
    return data;
  }

  private async storePost(userId: string, tweet: Tweet): Promise<void> {
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
      console.log(`Successfully stored post ${tweet.id} for user ${userId}`);
    } catch (error) {
      console.error(`Failed to store post ${tweet.id}:`, error);
    }
  }

  async getUserStats(authUser: UserContext["user"]): Promise<UserStats> {
    const user = await this.ensureUserExists(authUser);

    const postCountResult = this.sql
      .exec(
        `SELECT COUNT(*) as count FROM posts WHERE user_id = ?`,
        authUser.id
      )
      .toArray()[0] as { count: number };

    // Get recent posts for preview
    const postsResult = this.sql
      .exec<Post>(
        `SELECT * FROM posts WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`,
        user.id
      )
      .toArray();

    return {
      postCount: postCountResult.count,
      balance: user.balance,
      isPremium: Boolean(user.is_premium),
      initialized: Boolean(user.initialized),
      scrapeStatus: user.scrape_status as
        | "pending"
        | "in_progress"
        | "completed"
        | "failed",
      posts: postsResult.length > 0 ? postsResult : undefined,
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

      if (url.pathname === "/admin") {
        if (!ctx.authenticated) {
          return Response.redirect(url.origin + "/login", 302);
        }

        try {
          // Get user's Durable Object
          const userDO = env.USER_DO.get(
            env.USER_DO.idFromName(DO_NAME_PREFIX + ctx.user.id)
          );

          return studioMiddleware(request, userDO.raw, {
            dangerouslyDisableAuth: true,
          });
        } catch (error) {
          console.error("Dashboard error:", error);
          return new Response("Error loading admin", { status: 500 });
        }
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

      // Default redirect to login
      return Response.redirect(url.origin + "/login", 302);
    },
    {
      isLoginRequired: false,
      scope: "profile",
    }
  ),
} satisfies ExportedHandler<Env>;
