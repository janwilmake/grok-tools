/// <reference types="@cloudflare/workers-types" />
/// <reference lib="esnext" />

import { DurableObject } from "cloudflare:workers";
import { UserContext, withSimplerAuth } from "simplerauth-client";
import {
  Queryable,
  QueryableHandler,
  studioMiddleware,
} from "queryable-object";
import { withMcp } from "with-mcp";
//@ts-ignore
import openapi from "./openapi.json";
//@ts-ignore
import loginPage from "./login-template.html";
//@ts-ignore
import pricingTemplate from "./pricing-template.html";
import Stripe from "stripe";

const PAYMENT_LINK_ID = "plink_1SErNBCL0Yranfl4GPNXyXsH";
const DO_NAME_PREFIX = "v4:";
const SYNC_COST_PER_POST = 0.00015;
const SYNC_OVERLAP_HOURS = 24;

export interface Env {
  USER_DO: DurableObjectNamespace<UserDO & QueryableHandler>;
  X_API_KEY: string;
  STRIPE_WEBHOOK_SIGNING_SECRET: string;
  STRIPE_SECRET: string;
}

// Add this interface to your existing interfaces
interface PostSearchQuery {
  q?: string;
  maxTokens?: number;
}

interface ParsedQuery {
  from?: string;
  before?: Date;
  after?: Date;
  keywords: string[];
  operators: ("AND" | "OR")[];
}

interface ConversationThread {
  conversationId: string;
  posts: Post[];
  tokenCount: number;
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
  tweets: Tweet[];
  has_next_page: boolean;
  next_cursor?: string;
  status: "success" | "error";
  msg: "success" | "error";
  message?: string;
}

// Database Types
interface User extends Record<string, any> {
  id: string;
  username: string;
  is_premium: number;
  is_public: number;
  balance: number;
  initialized: number;
  scrape_status: "pending" | "in_progress" | "completed" | "failed";
  synced_from: string | null;
  synced_from_cursor: string | null;
  synced_until: string | null;
  is_sync_complete: number;
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
  isPublic: boolean;
  initialized: boolean;
  scrapeStatus: "pending" | "in_progress" | "completed" | "failed";
  syncComplete: boolean;
  syncedFrom: string | null;
  syncedUntil: string | null;
}

const dashboardPage = (
  user: UserContext["user"],
  stats: UserStats
) => `<!DOCTYPE html>
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
                        ${
                          stats.isPremium
                            ? '<span class="inline-block bg-amber-200 text-amber-800 px-2 py-1 rounded-full text-sm font-semibold">Premium</span>'
                            : ""
                        }
                    </div>
                </div>
                
                <div class="grid md:grid-cols-2 gap-6">
                    <div>
                        <h3 class="text-lg font-semibold mb-3 text-amber-800">Sync Status</h3>
                        <p class="text-amber-700 mb-4">
                            ${
                              stats.syncComplete
                                ? "Your X content is fully synchronized and ready for AI analysis."
                                : stats.scrapeStatus === "in_progress"
                                ? "Synchronizing your X content... This may take a while."
                                : stats.scrapeStatus === "failed"
                                ? "Failed to sync your content. Please refresh to retry."
                                : "Ready to start synchronization."
                            }
                        </p>
                        ${
                          stats.syncedFrom || stats.syncedUntil
                            ? `<div class="text-sm text-amber-600">
                                ${
                                  stats.syncedFrom
                                    ? `<div>Synced from: ${new Date(
                                        stats.syncedFrom
                                      ).toLocaleDateString()}</div>`
                                    : ""
                                }
                                ${
                                  stats.syncedUntil
                                    ? `<div>Synced until: ${new Date(
                                        stats.syncedUntil
                                      ).toLocaleDateString()}</div>`
                                    : ""
                                }
                              </div>`
                            : ""
                        }
                    </div>
                    
                    <div>
                        <h3 class="text-lg font-semibold mb-3 text-amber-800">Actions</h3>
                        <div class="space-y-3">
                            <a href="/admin" target="_blank" class="papyrus-button block text-center">Admin Panel</a>
                            <a href="/pricing" class="papyrus-button block text-center">Pricing</a>
                            <span onclick="window.location.href='/${
                              user.username
                            }?maxTokens=10000&q='+(prompt('Search query (optional) - Supports keywords, from:username, before:YYYY-MM-DD, after:YYYY-MM-DD, AND/OR operators')||'')" class="papyrus-button block text-center cursor-pointer">Search Posts</span>
                            <a href="https://installthismcp.com/X%20History%20MCP?url=https%3A%2F%2Fgrokthyself.com%2Fmcp" class="papyrus-button block text-center">Install Your MCP</a>
                            <a href="/logout" class="papyrus-button block text-center bg-red-200 hover:bg-red-300">Logout</a>
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
                        <div class="text-sm text-amber-600">Posts Synced</div>
                    </div>
                    <div>
                        <div class="text-2xl font-bold text-amber-700">$${(
                          stats.balance / 100
                        ).toFixed(2)}</div>
                        <div class="text-sm text-amber-600">Credits</div>
                    </div>
                    <div>
                        <div class="text-2xl font-bold text-amber-700">${
                          stats.syncComplete
                            ? "Complete"
                            : stats.scrapeStatus === "in_progress"
                            ? "Syncing"
                            : stats.scrapeStatus === "failed"
                            ? "Failed"
                            : "Ready"
                        }</div>
                        <div class="text-sm text-amber-600">Status</div>
                    </div>
                    <div>
                        <div class="text-2xl font-bold text-amber-700">${
                          stats.isPublic ? "Public" : "Private"
                        }</div>
                        <div class="text-sm text-amber-600">Visibility</div>
                    </div>
                </div>
            </div>
        </div>
    </main>
</body>
</html>`;

@Queryable()
export class UserDO extends DurableObject<Env> {
  public sql: SqlStorage;
  public try: SqlStorage["exec"];

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.sql = state.storage.sql;
    this.try = (query: string, ...params) => {
      try {
        return this.sql.exec(query, ...params);
      } catch {}
    };

    this.env = env;
    this.initializeTables();
  }

  private initializeTables() {
    // Create users table
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        is_public INTEGER DEFAULT 0,
        is_premium INTEGER DEFAULT 0,
        balance INTEGER DEFAULT 0,
        initialized INTEGER DEFAULT 0,
        scrape_status TEXT DEFAULT 'pending',
        synced_from TEXT,
        synced_from_cursor TEXT,
        synced_until TEXT,
        is_sync_complete INTEGER DEFAULT 0,
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

    // Add new columns if they don't exist
    this.try(`ALTER TABLE users ADD COLUMN is_public INTEGER DEFAULT 0`);
    this.try(`ALTER TABLE users ADD COLUMN synced_from TEXT`);
    this.try(`ALTER TABLE users ADD COLUMN synced_from_cursor TEXT`);
    this.try(`ALTER TABLE users ADD COLUMN synced_until TEXT`);
    this.try(`ALTER TABLE users ADD COLUMN is_sync_complete INTEGER DEFAULT 0`);

    // Create indexes
    this.sql.exec(
      `CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts (user_id)`
    );
    this.sql.exec(
      `CREATE INDEX IF NOT EXISTS idx_posts_tweet_id ON posts (tweet_id)`
    );
    this.sql.exec(
      `CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts (created_at)`
    );
  }

  async alarm(): Promise<void> {
    console.log("Alarm triggered - continuing sync");

    // Get user from database
    const user = this.sql
      .exec<User>(`SELECT * FROM users LIMIT 1`)
      .toArray()[0];
    if (!user) {
      console.log("No user found for alarm");
      return;
    }

    await this.performSync(user.id, user.username);
  }

  private parseSearchQuery(query: string): ParsedQuery {
    const parsed: ParsedQuery = {
      keywords: [],
      operators: [],
    };

    if (!query) return parsed;

    // Extract from: parameter
    const fromMatch = query.match(/from:(\w+)/i);
    if (fromMatch) {
      parsed.from = fromMatch[1];
      query = query.replace(/from:\w+/gi, "").trim();
    }

    // Extract before: parameter
    const beforeMatch = query.match(/before:(\d{4}-\d{2}-\d{2})/i);
    if (beforeMatch) {
      parsed.before = new Date(beforeMatch[1]);
      query = query.replace(/before:\d{4}-\d{2}-\d{2}/gi, "").trim();
    }

    // Extract after: parameter
    const afterMatch = query.match(/after:(\d{4}-\d{2}-\d{2})/i);
    if (afterMatch) {
      parsed.after = new Date(afterMatch[1]);
      query = query.replace(/after:\d{4}-\d{2}-\d{2}/gi, "").trim();
    }

    // Extract AND/OR operators and remaining keywords
    const tokens = query.split(/\s+/).filter((token) => token.length > 0);

    for (const token of tokens) {
      if (token.toUpperCase() === "AND" || token.toUpperCase() === "OR") {
        parsed.operators.push(token.toUpperCase() as "AND" | "OR");
      } else if (token.length > 0) {
        parsed.keywords.push(token.toLowerCase());
      }
    }

    return parsed;
  }

  private buildSearchSql(parsedQuery: ParsedQuery): {
    sql: string;
    params: any[];
  } {
    let sql = `SELECT DISTINCT conversation_id FROM posts WHERE 1=1`;
    const params: any[] = [];

    // Add from filter
    if (parsedQuery.from) {
      sql += ` AND LOWER(author_username) = LOWER(?)`;
      params.push(parsedQuery.from);
    }

    // Add date filters
    if (parsedQuery.before) {
      sql += ` AND date(created_at) < ?`;
      params.push(parsedQuery.before.toISOString().split("T")[0]);
    }

    if (parsedQuery.after) {
      sql += ` AND date(created_at) > ?`;
      params.push(parsedQuery.after.toISOString().split("T")[0]);
    }

    // Add keyword filters
    if (parsedQuery.keywords.length > 0) {
      const keywordConditions: string[] = [];

      for (const keyword of parsedQuery.keywords) {
        keywordConditions.push(`LOWER(text) LIKE ?`);
        params.push(`%${keyword}%`);
      }

      if (keywordConditions.length > 0) {
        // Default to AND if no operators specified, otherwise use the operators
        const operator =
          parsedQuery.operators.length > 0
            ? parsedQuery.operators[0] === "OR"
              ? " OR "
              : " AND "
            : " AND ";

        sql += ` AND (${keywordConditions.join(operator)})`;
      }
    }

    return { sql, params };
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 5);
  }

  private convertThreadToMarkdown(thread: ConversationThread): string {
    const sortedPosts = thread.posts.sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    let markdown = `# Thread\n\n`;

    for (const post of sortedPosts) {
      const date = new Date(post.created_at).toISOString().slice(0, 10);
      const isReply = post.is_reply ? "\t↳" : "";

      markdown += `${isReply}@${post.author_username} [${
        post.tweet_id
      }] (${date} ${post.like_count > 0 ? `❤️ ${post.like_count}` : ""}${
        post.retweet_count > 0 ? ` 🔄 ${post.retweet_count}` : ""
      }) - ${post.text.replaceAll("\n", "\t")}\n`;
    }

    return markdown + "\n\n";
  }

  async searchPosts(
    userId: string | undefined,
    searchQuery: PostSearchQuery
  ): Promise<string> {
    const user = this.sql.exec<User>(`SELECT * FROM users`).toArray()[0];

    if (!user) {
      return `User not found`;
    }

    if (!user.is_public && userId !== user.id) {
      return `User did not make posts public`;
    }

    const maxTokens = searchQuery.maxTokens || 10000;
    const parsedQuery = this.parseSearchQuery(searchQuery.q || "");

    console.log("Parsed query:", parsedQuery);

    // First, find matching conversation IDs
    const { sql: searchSql, params: searchParams } =
      this.buildSearchSql(parsedQuery);

    console.log("Search SQL:", searchSql, "Params:", searchParams);

    const conversationResults = this.sql
      .exec<{ conversation_id: string }>(searchSql, ...searchParams)
      .toArray();

    if (conversationResults.length === 0) {
      return "# No posts found\n\nYour search didn't match any posts.";
    }

    // Get conversation IDs
    const conversationIds = Array.from(
      new Set(
        conversationResults
          .map((row) => row.conversation_id)
          .filter((id) => id && id.trim() !== "")
      )
    );

    if (conversationIds.length === 0) {
      return "# No valid conversations found\n\nThe matching posts don't have valid conversation IDs.";
    }

    // Fetch all posts for these conversations
    const allPostsResult = this.sql
      .exec<Post>(
        `SELECT * FROM posts WHERE conversation_id IN (${conversationIds
          .map((x) => `'${x}'`)
          .join(",")})`
      )
      .toArray();

    console.log(`Found ${allPostsResult.length} total posts in conversations`);

    // Group posts by conversation and create threads
    const conversationMap = new Map<string, Post[]>();

    for (const post of allPostsResult) {
      const conversationId = post.conversation_id || "unknown";
      if (!conversationMap.has(conversationId)) {
        conversationMap.set(conversationId, []);
      }
      conversationMap.get(conversationId)!.push(post);
    }

    // Convert to threads with token estimation
    const threads: ConversationThread[] = [];
    let totalTokens = 0;

    for (const [conversationId, posts] of conversationMap) {
      if (posts.length === 0) continue;

      const thread: ConversationThread = {
        conversationId,
        posts,
        tokenCount: 0,
      };

      // Estimate tokens for this thread
      const markdown = this.convertThreadToMarkdown(thread);
      thread.tokenCount = this.estimateTokens(markdown);

      // Check if adding this thread would exceed token limit
      if (totalTokens + thread.tokenCount <= maxTokens) {
        threads.push(thread);
        totalTokens += thread.tokenCount;
      } else {
        console.log(
          `Stopping at thread ${conversationId} to stay within token limit`
        );
        break;
      }
    }

    console.log(
      `Selected ${threads.length} threads with ~${totalTokens} tokens`
    );

    // Sort threads by most recent post in each thread
    threads.sort((a, b) => {
      const latestA = Math.max(
        ...a.posts.map((p) => new Date(p.created_at).getTime())
      );
      const latestB = Math.max(
        ...b.posts.map((p) => new Date(p.created_at).getTime())
      );
      return latestB - latestA;
    });

    // Convert threads to markdown
    let finalMarkdown = `# Search Results\n\n`;
    finalMarkdown += `Query: \`${searchQuery.q || "all posts"}\`\n\n`;
    finalMarkdown += `Found ${threads.length} conversation threads (estimated ${totalTokens} tokens)\n\n`;
    finalMarkdown += `---\n\n`;

    for (const thread of threads) {
      finalMarkdown += this.convertThreadToMarkdown(thread);
    }

    return finalMarkdown;
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

    // Start sync if not started and user has balance
    if (user.scrape_status === "pending" && user.balance > 0) {
      console.log(`Starting sync for user ${authUser.username}`);
      this.sql.exec(
        `UPDATE users SET scrape_status = 'in_progress', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        authUser.id
      );

      // Start sync
      this.ctx.waitUntil(this.performSync(authUser.id, authUser.username));
    }

    return user;
  }

  async startSync(username: string): Promise<void> {
    console.log(`Starting sync for user ${username}`);
    const user = this.sql
      .exec<User>(`SELECT * FROM users WHERE username = ?`, username)
      .toArray()[0];

    if (!user) {
      console.log("Couldn't find user");
      return;
    }

    this.sql.exec(
      `UPDATE users SET scrape_status = 'in_progress', updated_at = CURRENT_TIMESTAMP WHERE username = ?`,
      username
    );

    await this.performSync(user.id, user.username);
  }

  private async performSync(userId: string, username: string): Promise<void> {
    try {
      console.log(`Performing sync for user ${username} (${userId})`);

      // Get current user state
      const userResult = this.sql
        .exec<User>(`SELECT * FROM users WHERE id = ?`, userId)
        .toArray();

      if (userResult.length === 0) {
        console.error(`User ${userId} not found`);
        return;
      }

      const user = userResult[0];

      // Check if user has sufficient balance
      if (user.balance <= 0) {
        console.log(`User ${username} has no balance, stopping sync`);
        this.sql.exec(
          `UPDATE users SET scrape_status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          userId
        );
        return;
      }

      // Determine sync direction and parameters
      const now = new Date();
      let syncBackwards = false;
      let cursor: string | undefined;

      if (!user.is_sync_complete) {
        // First sync - start from now and go backwards
        syncBackwards = true;
        cursor = user.synced_from_cursor;

        console.log(
          `First sync for ${username} - going backwards from ${cursor}`
        );
      } else {
        const syncedUntilDate = new Date(user.synced_until);
        const overlapDate = new Date(
          syncedUntilDate.getTime() - SYNC_OVERLAP_HOURS * 60 * 60 * 1000
        );
        cursor = user.synced_from_cursor;
        user.synced_until;
        // TODO: this doesn't seem right.
      }

      // Fetch posts
      const postsResponse = await this.fetchUserPosts(username, cursor);
      console.log(`Posts API response status: ${postsResponse.msg}`);

      if (
        postsResponse.msg !== "success" ||
        !postsResponse.data?.tweets?.length
      ) {
        console.log(`No new posts found for ${username}`);

        if (syncBackwards && !user.is_sync_complete) {
          // Mark sync as complete if we were going backwards and found no more posts
          this.sql.exec(
            `UPDATE users SET is_sync_complete = 1, synced_from_cursor = NULL, scrape_status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            userId
          );
          console.log(`Backwards sync completed for ${username}`);
        }
        return;
      }

      const tweets = postsResponse.data.tweets;
      console.log(`Found ${tweets.length} tweets for ${username}`);

      // Process all tweets in parallel
      const tweetProcessingPromises = tweets.map(async (tweet) => {
        let postsProcessed = 0;

        try {
          // Store the main tweet
          await this.storePost(userId, tweet);
          postsProcessed++;

          // Get thread context for this tweet
          try {
            const threadResponse = await this.fetchThreadContext(tweet.id);

            if (
              threadResponse.status === "success" &&
              threadResponse.tweets?.length
            ) {
              // Store all thread replies in parallel
              await Promise.all(
                threadResponse.tweets.map(async (reply) => {
                  await this.storePost(userId, reply);
                  return 1; // Count of posts processed
                })
              );
              postsProcessed += threadResponse.tweets.length;
            }
          } catch (error) {
            console.error(
              `Failed to fetch thread for tweet ${tweet.id}:`,
              error
            );
          }

          return postsProcessed;
        } catch (error) {
          console.error(`Failed to process tweet ${tweet.id}:`, error);
          return 0;
        }
      });

      // Wait for all tweet processing to complete
      const processingResults = await Promise.all(tweetProcessingPromises);
      const totalPostsProcessed = processingResults.reduce(
        (sum, count) => sum + count,
        0
      );

      console.log(`Processed ${totalPostsProcessed} posts total`);

      // Calculate cost and deduct from balance
      const cost = Math.ceil(totalPostsProcessed * SYNC_COST_PER_POST * 100); // Convert to cents
      console.log(
        `Processed ${totalPostsProcessed} posts, cost: $${cost / 100}`
      );

      // Update user record
      const newBalance = Math.max(0, user.balance - cost);
      const oldestTweet = tweets[tweets.length - 1];
      const newestTweet = tweets[0];

      let updateQuery: string;
      let updateParams: any[];

      if (syncBackwards) {
        // Update synced_from and cursor
        updateQuery = `
        UPDATE users SET 
          balance = ?, 
          synced_from = COALESCE(?, synced_from),
          synced_from_cursor = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `;
        updateParams = [
          newBalance,
          oldestTweet.createdAt,
          postsResponse.next_cursor || oldestTweet.id,
          userId,
        ];
      } else {
        // Update synced_until
        updateQuery = `
        UPDATE users SET 
          balance = ?, 
          synced_until = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `;
        updateParams = [newBalance, newestTweet.createdAt, userId];
      }

      this.sql.exec(updateQuery, ...updateParams);

      // Check if we should continue syncing
      const shouldContinue =
        newBalance > 0 &&
        (postsResponse.has_next_page ||
          (!syncBackwards && !user.is_sync_complete));

      if (shouldContinue) {
        console.log(`Scheduling next sync for ${username} in 1 second`);
        // Schedule next sync in 1 second
        await this.ctx.storage.setAlarm(Date.now() + 1000);
      } else {
        console.log(`Sync completed for ${username}`);
        this.sql.exec(
          `UPDATE users SET scrape_status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          userId
        );
      }
    } catch (error) {
      console.error(`Sync failed for user ${username}:`, error);
      this.sql.exec(
        `UPDATE users SET scrape_status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        userId
      );
    }
  }

  private async fetchUserPosts(
    username: string,
    cursor?: string
  ): Promise<TwitterAPIResponse> {
    let url = `https://api.twitterapi.io/twitter/user/last_tweets?userName=${username}&includeReplies=true`;

    if (cursor) {
      url += `&cursor=${cursor}`;
    }

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
    tweetId: string,
    cursor?: string
  ): Promise<ThreadContextResponse> {
    const baseUrl = `https://api.twitterapi.io/twitter/tweet/thread_context?tweetId=${tweetId}`;
    const url = cursor ? `${baseUrl}&cursor=${cursor}` : baseUrl;

    // console.log(`Fetching thread context from: ${url}`);

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

    // If there are more pages, recursively fetch them
    if (data.has_next_page && data.next_cursor) {
      // console.log(`Fetching next page with cursor: ${data.next_cursor}`);

      try {
        const nextPageData = await this.fetchThreadContext(
          tweetId,
          data.next_cursor
        );

        // Merge the tweets from subsequent pages
        return {
          ...data,
          tweets: [...(data.tweets || []), ...(nextPageData.tweets || [])],
          has_next_page: nextPageData.has_next_page,
          next_cursor: nextPageData.next_cursor,
        };
      } catch (error) {
        console.error(
          `Failed to fetch next page for thread ${tweetId}:`,
          error
        );
        // Return current data if next page fails
        return data;
      }
    }

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

    return {
      postCount: postCountResult.count,
      balance: user.balance,
      isPremium: Boolean(user.is_premium),
      isPublic: Boolean(user.is_public),
      initialized: Boolean(user.initialized),
      scrapeStatus: user.scrape_status as
        | "pending"
        | "in_progress"
        | "completed"
        | "failed",
      syncComplete: Boolean(user.is_sync_complete),
      syncedFrom: user.synced_from,
      syncedUntil: user.synced_until,
    };
  }
}

export default {
  fetch: withMcp(
    withSimplerAuth(
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
              env.USER_DO.idFromName(DO_NAME_PREFIX + ctx.user.username)
            );

            return studioMiddleware(request, userDO.raw, {
              dangerouslyDisableAuth: true,
            });
          } catch (error) {
            console.error("Admin error:", error);
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
              env.USER_DO.idFromName(DO_NAME_PREFIX + ctx.user.username)
            );

            // Get user stats
            const stats = await userDO.getUserStats(ctx.user);
            const dashboardHtml = dashboardPage(ctx.user, stats);

            return new Response(dashboardHtml, {
              headers: { "Content-Type": "text/html" },
            });
          } catch (error) {
            console.error("Dashboard error:", error);
            return new Response("Error loading dashboard", { status: 500 });
          }
        }

        if (url.pathname === "/stripe-webhook") {
          return handleStripeWebhook(request, env);
        }
        if (url.pathname === "/sync") {
          if (!ctx.user?.username) {
            return new Response("Unauthorized", { status: 401 });
          }
          const userDO = env.USER_DO.get(
            env.USER_DO.idFromName(DO_NAME_PREFIX + ctx.user.username)
          );

          // Start sync after payment
          await userDO.startSync(ctx.user.username);
          return new Response("Started sync");
        }

        // Handle pricing page
        if (url.pathname === "/pricing") {
          if (!ctx.authenticated) {
            return Response.redirect(url.origin + "/login", 302);
          }

          try {
            // Get user's Durable Object
            const userDO = env.USER_DO.get(
              env.USER_DO.idFromName(DO_NAME_PREFIX + ctx.user.username)
            );

            // Get user stats to check premium status
            const stats = await userDO.getUserStats(ctx.user);

            // Inject user data into the template
            const pricingPageWithData = pricingTemplate.replace(
              "const userData = {};",
              `const userData = {
          username: "${ctx.user.username}",
          isPremium: ${stats.isPremium},
          balance: ${stats.balance},
          postCount: ${stats.postCount},
          scrapeStatus: "${stats.scrapeStatus}"
        };`
            );

            return new Response(pricingPageWithData, {
              headers: { "Content-Type": "text/html" },
            });
          } catch (error) {
            console.error("Pricing page error:", error);
            return new Response("Error loading pricing page", { status: 500 });
          }
        }

        // assume its a username (or /search and authenticated)

        try {
          // Get query parameters
          const query = url.searchParams.get("q") || "";
          const maxTokensParam = url.searchParams.get("maxTokens");
          const maxTokens = maxTokensParam
            ? parseInt(maxTokensParam, 10)
            : 10000;

          if (maxTokens < 1 || maxTokens > 5000000) {
            return new Response(
              JSON.stringify({
                error: "maxTokens must be between 1 and 5000000",
              }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              }
            );
          }

          console.log(
            `Posts search request: q="${query}", maxTokens=${maxTokens}`
          );

          const username =
            url.pathname === "/search"
              ? ctx.user?.username
              : url.pathname.slice(1);

          if (!username) {
            return new Response("Unauthorized", { status: 401 });
          }

          // Get user's Durable Object
          const userDO = env.USER_DO.get(
            env.USER_DO.idFromName(DO_NAME_PREFIX + username)
          );

          // Perform search
          const markdown = await userDO.searchPosts(ctx.user?.id, {
            q: query,
            maxTokens,
          });

          // Return as markdown
          return new Response(markdown, {
            headers: {
              "Content-Type": "text/markdown; charset=utf-8",
              "Content-Disposition": `inline; filename="${username}.md"`,
            },
          });
        } catch (error) {
          console.error("Posts search error:", error);
          return new Response(
            JSON.stringify({
              error: "Error searching posts",
              details: error instanceof Error ? error.message : String(error),
            }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
      },
      {
        isLoginRequired: false,
        scope: "profile",
      }
    ),
    openapi,
    {
      authEndpoint: "/me",
      toolOperationIds: ["search"],
      serverInfo: { name: "X History MCP", version: "1.0.0" },
    }
  ),
} satisfies ExportedHandler<Env>;

const streamToBuffer = async (
  readableStream: ReadableStream<Uint8Array>
): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = [];
  const reader = readableStream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);

  let position = 0;
  for (const chunk of chunks) {
    result.set(chunk, position);
    position += chunk.length;
  }

  return result;
};

async function handleStripeWebhook(
  request: Request,
  env: Env
): Promise<Response> {
  if (!request.body) {
    return new Response(JSON.stringify({ error: "No body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rawBody = await streamToBuffer(request.body);
  const rawBodyString = new TextDecoder().decode(rawBody);

  const stripe = new Stripe(env.STRIPE_SECRET, {
    apiVersion: "2025-03-31.basil",
  });

  const stripeSignature = request.headers.get("stripe-signature");
  if (!stripeSignature) {
    return new Response(JSON.stringify({ error: "No signature" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBodyString,
      stripeSignature,
      env.STRIPE_WEBHOOK_SIGNING_SECRET
    );
  } catch (err) {
    console.log("WEBHOOK ERR", err.message);
    return new Response(`Webhook error: ${String(err)}`, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    console.log("CHECKOUT COMPLETED");
    const session = event.data.object;

    if (session.payment_status !== "paid" || !session.amount_total) {
      return new Response("Payment not completed", { status: 400 });
    }

    const {
      client_reference_id: username,
      amount_total,
      payment_link,
    } = session;

    if (payment_link !== PAYMENT_LINK_ID) {
      return new Response("Invalid payment link", { status: 400 });
    }

    if (!username) {
      return new Response("Missing username", { status: 400 });
    }

    const userDO = env.USER_DO.get(
      env.USER_DO.idFromName(DO_NAME_PREFIX + username)
    );

    // Update balance and premium status
    await userDO.exec(
      "UPDATE users SET is_premium = 1, balance = balance + ? WHERE username = ?",
      amount_total,
      username
    );

    // Start sync after payment
    await userDO.startSync(username);

    return new Response("Payment processed successfully", { status: 200 });
  }

  return new Response("Event not handled", { status: 200 });
}
