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
const FREE_SIGNUP_BALANCE = 100; // $1.00 in cents
const FREE_MAX_HISTORIC_POSTS = 2000;
const PREMIUM_MAX_HISTORIC_POSTS = 100000;
const ADMIN_USERNAME = "janwilmake";
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

interface Tweet {
  type: "tweet";
  id: string;
  url: string;
  twitterUrl: string;
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
  extendedEntities?: ExtendedEntities;
  card?: any;
  place?: any;
  entities?: TweetEntities;
  quoted_tweet?: Tweet;
  retweeted_tweet?: Tweet;
}

interface AuthorStats {
  username: string;
  name: string;
  postCount: number;
  profileImageUrl: string;
  bio: string;
  location: string;
  url: string;
  isVerified: boolean;
  latestPostDate: string;
}
interface UserInfo {
  type: "user";
  userName: string;
  url: string;
  twitterUrl: string;
  id: string;
  name: string;
  isVerified: boolean;
  isBlueVerified: boolean;
  profilePicture: string;
  coverPicture?: string;
  description?: string;
  location?: string;
  followers: number;
  following: number;
  status?: string;
  canDm: boolean;
  canMediaTag?: boolean;
  createdAt: string;
  entities?: UserEntities;
  fastFollowersCount?: number;
  favouritesCount: number;
  hasCustomTimelines?: boolean;
  isTranslator?: boolean;
  mediaCount?: number;
  statusesCount: number;
  protected?: boolean;
  withheldInCountries?: string[];
  affiliatesHighlightedLabel?: any;
  possiblySensitive?: boolean;
  pinnedTweetIds?: string[];
  profile_bio?: string;
}

interface UserEntities {
  url?: {
    urls: UrlEntity[];
  };
  description?: {
    hashtags: HashtagEntity[];
    symbols: SymbolEntity[];
    urls: UrlEntity[];
    user_mentions: UserMentionEntity[];
  };
}

interface TweetEntities {
  hashtags?: HashtagEntity[];
  symbols?: SymbolEntity[];
  urls?: UrlEntity[];
  user_mentions?: UserMentionEntity[];
  media?: MediaEntity[];
  poll?: any;
}

interface ExtendedEntities {
  media?: MediaEntity[];
}

interface UrlEntity {
  display_url: string;
  expanded_url: string;
  indices: number[];
  url: string;
}

interface HashtagEntity {
  indices: number[];
  text: string;
}

interface SymbolEntity {
  indices: number[];
  text: string;
}

interface UserMentionEntity {
  id_str: string;
  indices: number[];
  name: string;
  screen_name: string;
}

interface MediaEntity {
  id_str: string;
  media_url_https: string;
  url: string;
  display_url: string;
  expanded_url: string;
  video_info?: {
    aspect_ratio: [number, number];
    duration_millis?: number;
    variants: {
      content_type: string;
      url: string;
      bitrate?: number;
    }[];
  };
  type: "photo" | "video" | "animated_gif";
  indices: number[];
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
  is_featured: number;
  balance: number;
  scrape_status: "pending" | "in_progress" | "completed" | "failed";

  // New sync fields
  history_max_count: number;
  history_cursor: string | null;
  history_count: number;
  history_is_completed: number;
  synced_from: string | null;
  synced_from_cursor: string | null;
  synced_until: string | null;

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
  is_historic: number; // 1 for historic sync, 0 for frontfill
}

interface UserStats {
  postCount: number;
  balance: number;
  isPremium: boolean;
  isPublic: boolean;
  isFeatured: boolean;
  scrapeStatus: "pending" | "in_progress" | "completed" | "failed";
  historyMaxCount: number;
  historyCount: number;
  historyIsCompleted: boolean;
  syncedFrom: string | null;
  syncedUntil: string | null;
}

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
    // Create users table with new schema
    this.sql.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      is_public INTEGER DEFAULT 0,
      is_premium INTEGER DEFAULT 0,
      is_featured INTEGER DEFAULT 0,
      balance INTEGER DEFAULT ${FREE_SIGNUP_BALANCE},
      scrape_status TEXT DEFAULT 'pending',
      
      history_max_count INTEGER DEFAULT ${FREE_MAX_HISTORIC_POSTS},
      history_cursor TEXT,
      history_count INTEGER DEFAULT 0,
      history_is_completed INTEGER DEFAULT 0,
      synced_from TEXT,
      synced_from_cursor TEXT,
      synced_until TEXT,
      
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

    // Create posts table with new columns
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
      author_profile_image_url TEXT,
      author_bio TEXT,
      author_location TEXT,
      author_url TEXT,
      author_verified INTEGER DEFAULT 0,
      bookmark_count INTEGER DEFAULT 0,
      view_count INTEGER DEFAULT 0,
      is_historic INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )
  `);

    // Add new column migrations for users table
    this.try(`ALTER TABLE users ADD COLUMN is_public INTEGER DEFAULT 0`);
    this.try(`ALTER TABLE users ADD COLUMN is_featured INTEGER DEFAULT 0`);
    this.try(
      `ALTER TABLE users ADD COLUMN history_max_count INTEGER DEFAULT ${FREE_MAX_HISTORIC_POSTS}`
    );
    this.try(`ALTER TABLE users ADD COLUMN history_cursor TEXT`);
    this.try(`ALTER TABLE users ADD COLUMN history_count INTEGER DEFAULT 0`);
    this.try(
      `ALTER TABLE users ADD COLUMN history_is_completed INTEGER DEFAULT 0`
    );
    this.try(`ALTER TABLE users ADD COLUMN synced_from TEXT`);
    this.try(`ALTER TABLE users ADD COLUMN synced_from_cursor TEXT`);
    this.try(`ALTER TABLE users ADD COLUMN synced_until TEXT`);

    // Add new column migrations for posts table
    this.try(`ALTER TABLE posts ADD COLUMN author_profile_image_url TEXT`);
    this.try(`ALTER TABLE posts ADD COLUMN author_bio TEXT`);
    this.try(`ALTER TABLE posts ADD COLUMN author_location TEXT`);
    this.try(`ALTER TABLE posts ADD COLUMN author_url TEXT`);
    this.try(`ALTER TABLE posts ADD COLUMN author_verified INTEGER DEFAULT 0`);
    this.try(`ALTER TABLE posts ADD COLUMN bookmark_count INTEGER DEFAULT 0`);
    this.try(`ALTER TABLE posts ADD COLUMN view_count INTEGER DEFAULT 0`);
    this.try(`ALTER TABLE posts ADD COLUMN is_historic INTEGER DEFAULT 0`);

    // Remove old columns if they exist
    this.try(`ALTER TABLE users DROP COLUMN initialized`);
    this.try(`ALTER TABLE users DROP COLUMN is_sync_complete`);

    // Create indexes
    this.try(`CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts (user_id)`);
    this.try(
      `CREATE INDEX IF NOT EXISTS idx_posts_tweet_id ON posts (tweet_id)`
    );
    this.try(
      `CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts (created_at)`
    );
    this.try(
      `CREATE INDEX IF NOT EXISTS idx_posts_author_created ON posts (author_username, created_at DESC)`
    );
    this.try(
      `CREATE INDEX IF NOT EXISTS idx_posts_is_historic ON posts (is_historic)`
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

  async getAuthorStats(
    requestingUsername: string | undefined,
    limit?: number
  ): Promise<AuthorStats[]> {
    const user = this.sql.exec<User>(`SELECT * FROM users`).toArray()[0];

    if (!user) {
      throw new Error("User not found");
    }

    if (
      !user.is_public &&
      requestingUsername !== user.username &&
      requestingUsername !== ADMIN_USERNAME
    ) {
      throw new Error("User did not make posts public");
    }

    // Get author stats with most recent post data for each author
    const authorStatsResult = this.sql
      .exec<{
        author_username: string;
        author_name: string;
        post_count: number;
        author_profile_image_url: string;
        author_bio: string;
        author_location: string;
        author_url: string;
        author_verified: number;
        latest_post_date: string;
      }>(
        `
    WITH author_post_counts AS (
      SELECT 
        author_username,
        COUNT(*) as post_count
      FROM posts 
      GROUP BY author_username
    ),
    latest_author_posts AS (
      SELECT DISTINCT
        author_username,
        FIRST_VALUE(author_name) OVER (PARTITION BY author_username ORDER BY created_at DESC) as author_name,
        FIRST_VALUE(author_profile_image_url) OVER (PARTITION BY author_username ORDER BY created_at DESC) as author_profile_image_url,
        FIRST_VALUE(author_bio) OVER (PARTITION BY author_username ORDER BY created_at DESC) as author_bio,
        FIRST_VALUE(author_location) OVER (PARTITION BY author_username ORDER BY created_at DESC) as author_location,
        FIRST_VALUE(author_url) OVER (PARTITION BY author_username ORDER BY created_at DESC) as author_url,
        FIRST_VALUE(author_verified) OVER (PARTITION BY author_username ORDER BY created_at DESC) as author_verified,
        FIRST_VALUE(created_at) OVER (PARTITION BY author_username ORDER BY created_at DESC) as latest_post_date
      FROM posts
    )
    SELECT 
      apc.author_username,
      lap.author_name,
      apc.post_count,
      lap.author_profile_image_url,
      lap.author_bio,
      lap.author_location,
      lap.author_url,
      lap.author_verified,
      lap.latest_post_date
    FROM author_post_counts apc
    JOIN latest_author_posts lap ON apc.author_username = lap.author_username
    ORDER BY apc.post_count DESC
  `
      )
      .toArray();

    const mapped = authorStatsResult
      .map((row) => ({
        username: row.author_username,
        name: row.author_name || row.author_username,
        postCount: row.post_count,
        profileImageUrl: row.author_profile_image_url || "",
        bio: row.author_bio || "",
        location: row.author_location || "",
        url: row.author_url || "",
        isVerified: Boolean(row.author_verified),
        latestPostDate: row.latest_post_date,
      }))
      .filter((row) => row.username !== user.username);

    return limit ? mapped.slice(0, limit) : mapped;
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

  private addPaymentNoticeIfNeeded(
    markdown: string,
    user: User,
    requestedUsername: string
  ): string {
    if (!user.is_premium && user.username === requestedUsername) {
      const paymentNotice = `

---

**💰 Upgrade to Premium** 

You're currently on the free tier (${user.history_count}/${user.history_max_count} historic posts synced).

Upgrade to Premium for:
- Up to 100,000 historic posts
- Continued sync of future posts
- Priority support

[Upgrade now →](https://grokthyself.com/pricing)

---

`;
      return markdown + paymentNotice;
    }
    return markdown;
  }

  async searchPosts(
    username: string | undefined,
    searchQuery: PostSearchQuery
  ): Promise<string> {
    const user = this.sql.exec<User>(`SELECT * FROM users`).toArray()[0];

    if (!user) {
      return `User not found`;
    }

    if (
      !user.is_public &&
      username !== user.username &&
      username !== ADMIN_USERNAME
    ) {
      return `User did not make posts public`;
    }

    // Check if we should start a sync (frontfill)
    if (username === user.username && this.shouldStartFrontfillSync(user)) {
      console.log(`Starting frontfill sync for ${user.username}`);
      this.ctx.waitUntil(this.performSync(user.id, user.username));
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
      const markdown =
        "# No posts found\n\nYour search didn't match any posts.";
      return this.addPaymentNoticeIfNeeded(markdown, user, username);
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
      const markdown =
        "# No valid conversations found\n\nThe matching posts don't have valid conversation IDs.";
      return this.addPaymentNoticeIfNeeded(markdown, user, username);
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

    return this.addPaymentNoticeIfNeeded(finalMarkdown, user, username);
  }

  async ensureUserExists(u: string): Promise<User | null> {
    const data = await fetch(
      `https://profile.grok-tools.com/${u}?secret=mysecret`
    ).then((res) =>
      res.json<{
        id?: string;
        userName?: string;
        error?: string;
        message?: string;
      }>()
    );

    const { id, userName: username, error, message } = data;
    if (!id || !username) {
      console.error(`error ${error} ${message}`);
      console.log({ data });
      return null;
    }

    // Insert user if not exists
    const existingUserResult = this.sql
      .exec(`SELECT * FROM users WHERE id = ?`, id)
      .toArray();

    if (existingUserResult.length === 0) {
      this.sql.exec(
        `INSERT INTO users (id, username) VALUES (?, ?)`,
        id,
        username
      );
    }

    // Get current user state
    const userResult = this.sql
      .exec<User>(`SELECT * FROM users WHERE id = ?`, id)
      .toArray();

    const user = userResult[0];

    // Start sync if pending and has balance
    if (user.scrape_status === "pending" && user.balance > 0) {
      console.log(`Starting initial sync for user ${username}`);
      this.sql.exec(
        `UPDATE users SET scrape_status = 'in_progress', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        id
      );

      // Start sync
      this.ctx.waitUntil(this.performSync(id, username));
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

  private shouldStartFrontfillSync(user: User): boolean {
    if (user.balance <= 0 || user.scrape_status === "in_progress") {
      return false;
    }

    // If synced_from is null or more than 24 hours ago
    if (!user.synced_from) {
      return true;
    }

    const syncedFromDate = new Date(user.synced_from);
    const now = new Date();
    const hoursSinceSync =
      (now.getTime() - syncedFromDate.getTime()) / (1000 * 60 * 60);

    return hoursSinceSync > SYNC_OVERLAP_HOURS;
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

      // Determine sync type and direction
      const syncType = this.determineSyncType(user);
      console.log(`Sync type for ${username}: ${syncType}`);

      if (syncType === "historic") {
        await this.performHistoricSync(user);
      } else if (syncType === "frontfill") {
        await this.performFrontfillSync(user);
      } else {
        console.log(`No sync needed for ${username}`);
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

  private determineSyncType(user: User): "historic" | "frontfill" | "none" {
    // If history is not completed and we haven't reached the limit, do historic sync
    if (
      !user.history_is_completed &&
      user.history_count < user.history_max_count
    ) {
      return "historic";
    }

    // If synced_from is null or more than 24 hours ago, do frontfill
    if (!user.synced_from) {
      return "frontfill";
    }

    const syncedFromDate = new Date(user.synced_from);
    const now = new Date();
    const hoursSinceSync =
      (now.getTime() - syncedFromDate.getTime()) / (1000 * 60 * 60);

    if (hoursSinceSync > SYNC_OVERLAP_HOURS) {
      return "frontfill";
    }

    return "none";
  }

  private async performHistoricSync(user: User): Promise<void> {
    console.log(`Performing historic sync for ${user.username}`);

    // Fetch posts going backwards from cursor
    const postsResponse = await this.fetchUserPosts(
      user.username,
      user.history_cursor
    );

    if (
      postsResponse.msg !== "success" ||
      !postsResponse.data?.tweets?.length
    ) {
      console.log(
        `No more historic posts found for ${user.username} (history_is_completed=1)`
      );
      // Mark history as completed
      this.sql.exec(
        `UPDATE users SET 
          history_is_completed = 1, 
          history_cursor = NULL,
          scrape_status = 'completed',
          updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        user.id
      );
      return;
    }

    const tweets = postsResponse.data.tweets;
    console.log(`Found ${tweets.length} historic tweets for ${user.username}`);

    // Process tweets and count historic posts
    let historicPostsAdded = 0;
    const tweetProcessingPromises = tweets.map(async (tweet) => {
      let postsProcessed = 0;

      try {
        // Store the main tweet as historic
        await this.storePost(user.id, tweet, true);
        postsProcessed++;

        // Get thread context for this tweet
        try {
          const threadResponse = await this.fetchThreadContext(tweet.id);

          if (
            threadResponse.status === "success" &&
            threadResponse.tweets?.length
          ) {
            await Promise.all(
              threadResponse.tweets.map(async (reply) => {
                await this.storePost(user.id, reply, true);
                return 1;
              })
            );
            postsProcessed += threadResponse.tweets.length;
          }
        } catch (error) {
          console.error(`Failed to fetch thread for tweet ${tweet.id}:`, error);
        }

        return postsProcessed;
      } catch (error) {
        console.error(`Failed to process tweet ${tweet.id}:`, error);
        return 0;
      }
    });

    const processingResults = await Promise.all(tweetProcessingPromises);
    const totalPostsProcessed = processingResults.reduce(
      (sum, count) => sum + count,
      0
    );

    // Calculate cost and deduct from balance
    const cost = Math.ceil(totalPostsProcessed * SYNC_COST_PER_POST * 100);
    const newBalance = Math.max(0, user.balance - cost);
    const newHistoryCount = user.history_count + totalPostsProcessed;

    console.log(
      `Historic sync: processed ${totalPostsProcessed} posts, cost: $${
        cost / 100
      }, new count: ${newHistoryCount}/${user.history_max_count}`
    );

    // Update user record
    const oldestTweet = tweets[tweets.length - 1];

    this.sql.exec(
      `UPDATE users SET 
        balance = ?, 
        history_count = ?,
        history_cursor = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      newBalance,
      newHistoryCount,
      postsResponse.next_cursor || oldestTweet.id,
      user.id
    );

    // Check if we should continue historic sync
    const shouldContinue =
      newBalance > 0 &&
      newHistoryCount < user.history_max_count &&
      postsResponse.has_next_page;

    if (shouldContinue) {
      console.log(`Scheduling next historic sync for ${user.username}`);
      await this.ctx.storage.setAlarm(Date.now() + 1000);
    } else {
      console.log(
        `Historic sync completed (stopped, not done) for ${user.username}`
      );
      this.sql.exec(
        `UPDATE users SET 
          scrape_status = 'completed',
          updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        user.id
      );
    }
  }

  private async performFrontfillSync(user: User): Promise<void> {
    console.log(`Performing frontfill sync for ${user.username}`);

    // Set synced_until to current time if not set
    if (!user.synced_until) {
      const now = new Date().toISOString();
      this.sql.exec(
        `UPDATE users SET synced_until = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        now,
        user.id
      );
      user.synced_until = now;
    }

    // Fetch recent posts (no cursor = get latest)
    const postsResponse = await this.fetchUserPosts(
      user.username,
      user.synced_from_cursor
    );

    if (
      postsResponse.msg !== "success" ||
      !postsResponse.data?.tweets?.length
    ) {
      console.log(`No new posts found for frontfill sync for ${user.username}`);
      this.sql.exec(
        `UPDATE users SET scrape_status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        user.id
      );
      return;
    }

    const tweets = postsResponse.data.tweets;
    console.log(`Found ${tweets.length} frontfill tweets for ${user.username}`);

    // Process tweets as non-historic
    const tweetProcessingPromises = tweets.map(async (tweet) => {
      let postsProcessed = 0;

      try {
        await this.storePost(user.id, tweet, false);
        postsProcessed++;

        try {
          const threadResponse = await this.fetchThreadContext(tweet.id);

          if (
            threadResponse.status === "success" &&
            threadResponse.tweets?.length
          ) {
            await Promise.all(
              threadResponse.tweets.map(async (reply) => {
                await this.storePost(user.id, reply, false);
                return 1;
              })
            );
            postsProcessed += threadResponse.tweets.length;
          }
        } catch (error) {
          console.error(`Failed to fetch thread for tweet ${tweet.id}:`, error);
        }

        return postsProcessed;
      } catch (error) {
        console.error(`Failed to process tweet ${tweet.id}:`, error);
        return 0;
      }
    });

    const processingResults = await Promise.all(tweetProcessingPromises);
    const totalPostsProcessed = processingResults.reduce(
      (sum, count) => sum + count,
      0
    );

    // Calculate cost and deduct from balance
    const cost = Math.ceil(totalPostsProcessed * SYNC_COST_PER_POST * 100);
    const newBalance = Math.max(0, user.balance - cost);

    console.log(
      `Frontfill sync: processed ${totalPostsProcessed} posts, cost: $${
        cost / 100
      }`
    );

    // Update synced_from to the newest tweet's date
    const newestTweet = tweets[0];
    const oldestTweet = tweets[tweets.length - 1];

    // Check if we've reached the overlap point
    const syncedUntilDate = new Date(user.synced_until);
    const overlapDate = new Date(
      syncedUntilDate.getTime() - SYNC_OVERLAP_HOURS * 60 * 60 * 1000
    );
    const oldestTweetDate = new Date(oldestTweet.createdAt);

    if (oldestTweetDate <= overlapDate) {
      // We've reached the overlap, update synced_from to synced_until
      this.sql.exec(
        `UPDATE users SET 
          balance = ?,
          synced_from = synced_until,
          synced_from_cursor = NULL,
          scrape_status = 'completed',
          updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        newBalance,
        user.id
      );
      console.log(
        `Frontfill sync completed (reached overlap) for ${user.username}`
      );
    } else {
      // Continue frontfill sync
      this.sql.exec(
        `UPDATE users SET 
          balance = ?,
          synced_from_cursor = ?,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        newBalance,
        postsResponse.next_cursor || oldestTweet.id,
        user.id
      );

      // Check if we should continue
      if (newBalance > 0 && postsResponse.has_next_page) {
        console.log(`Scheduling next frontfill sync for ${user.username}`);
        await this.ctx.storage.setAlarm(Date.now() + 1000);
      } else {
        console.log(
          `Frontfill sync completed (no balance/pages) for ${user.username}`
        );
        this.sql.exec(
          `UPDATE users SET scrape_status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          user.id
        );
      }
    }
  }

  private async fetchUserPosts(
    username: string,
    cursor?: string | null
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
      try {
        const nextPageData = await this.fetchThreadContext(
          tweetId,
          data.next_cursor
        );

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
        return data;
      }
    }

    return data;
  }

  private formatTweetText(tweet: Tweet): string {
    let tweetText = tweet.text || "";

    // Expand URLs in the tweet text
    if (tweet.entities?.urls && tweet.entities.urls.length > 0) {
      for (const urlEntity of tweet.entities.urls) {
        tweetText = tweetText.replace(urlEntity.url, urlEntity.expanded_url);
      }
    }

    // Remove media URLs from text to avoid duplication since we'll store them separately
    if (
      tweet.extendedEntities?.media &&
      tweet.extendedEntities.media.length > 0
    ) {
      for (const media of tweet.extendedEntities.media) {
        tweetText = tweetText.replace(media.url, "");
      }
    }

    return tweetText.trim();
  }

  private extractMediaUrls(tweet: Tweet): string {
    const mediaItems: string[] = [];

    if (
      tweet.extendedEntities?.media &&
      tweet.extendedEntities.media.length > 0
    ) {
      const uniqueMedia = new Set(
        tweet.extendedEntities.media
          .map((media) => {
            // For photos, just include the URL
            if (media.type === "photo") {
              return `[Image: ${media.media_url_https}]`;
            }
            // For videos and GIFs, include both the thumbnail and video URL if available
            else if (media.type === "video" || media.type === "animated_gif") {
              const videoUrl = media.video_info?.variants?.[0]?.url || "";
              if (videoUrl) {
                return `[Video: ${videoUrl}]`;
              } else {
                return `[Video: ${media.media_url_https}]`;
              }
            }
            return "";
          })
          .filter((item) => item.length > 0)
      );

      mediaItems.push(...Array.from(uniqueMedia));
    }

    return mediaItems.join("\n");
  }

  private formatAuthorBio(author: UserInfo): string {
    let bio = author.description || "";

    // Expand URLs in bio
    if (
      author.entities?.description?.urls &&
      author.entities.description.urls.length > 0
    ) {
      for (const urlEntity of author.entities.description.urls) {
        bio = bio.replace(urlEntity.url, urlEntity.expanded_url);
      }
    }

    return bio;
  }

  private getAuthorUrl(author: UserInfo): string {
    // Check if there's a URL in the author's entities
    if (author.entities?.url?.urls && author.entities.url.urls.length > 0) {
      return author.entities.url.urls[0].expanded_url;
    }
    return "";
  }

  private getProfileImageUrl(profilePicture: string): string {
    // Replace _normal with _400x400 for higher resolution
    return profilePicture.replace(/_normal\./, "_400x400.");
  }

  private async storePost(
    userId: string,
    tweet: Tweet,
    isHistoric: boolean = false
  ): Promise<void> {
    try {
      const formattedText = this.formatTweetText(tweet);
      const mediaUrls = this.extractMediaUrls(tweet);
      const fullTextWithMedia = mediaUrls
        ? `${formattedText}\n${mediaUrls}`
        : formattedText;

      const authorBio = this.formatAuthorBio(tweet.author);
      const authorUrl = this.getAuthorUrl(tweet.author);
      const authorProfileImage = tweet.author.profilePicture
        ? this.getProfileImageUrl(tweet.author.profilePicture)
        : "";

      this.sql.exec(
        `INSERT OR REPLACE INTO posts (
        user_id, tweet_id, text, author_username, author_name,
        created_at, like_count, retweet_count, reply_count,
        is_reply, conversation_id, raw_data,
        author_profile_image_url, author_bio, author_location,
        author_url, author_verified, bookmark_count, view_count, is_historic
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        userId,
        tweet.id,
        fullTextWithMedia,
        tweet.author?.userName || "",
        tweet.author?.name || "",
        tweet.createdAt ? new Date(tweet.createdAt).toISOString() : "",
        tweet.likeCount || 0,
        tweet.retweetCount || 0,
        tweet.replyCount || 0,
        tweet.isReply ? 1 : 0,
        tweet.conversationId || "",
        JSON.stringify(tweet),
        authorProfileImage,
        authorBio,
        tweet.author?.location || "",
        authorUrl,
        tweet.author?.isBlueVerified ? 1 : 0,
        tweet.bookmarkCount || 0,
        tweet.viewCount || 0,
        isHistoric ? 1 : 0
      );
    } catch (error) {
      console.error(`Failed to store post ${tweet.id}:`, error);
    }
  }

  async getUserStats(authUser: UserContext["user"]): Promise<UserStats | null> {
    const user = await this.ensureUserExists(authUser?.username);
    console.log({ user });
    if (!user) {
      return null;
    }
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
      isFeatured: Boolean(user.is_featured),
      scrapeStatus: user.scrape_status as
        | "pending"
        | "in_progress"
        | "completed"
        | "failed",
      historyMaxCount: user.history_max_count,
      historyCount: user.history_count,
      historyIsCompleted: Boolean(user.history_is_completed),
      syncedFrom: user.synced_from,
      syncedUntil: user.synced_until,
    };
  }
}

// In the statsPage function, modify the CSS styles section:
const statsPage = (
  username: string,
  stats: AuthorStats[],
  userStats?: { isPremium: boolean; historyCount: number }
) => `<!DOCTYPE html>
<html lang="en" class="bg-amber-50">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Interaction Stats - @${username} - Grok Thyself</title>
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
            font-size: clamp(1.5rem, 4vw, 2.25rem);
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

        .author-card {
            background: rgba(255, 255, 255, 0.3);
            border: 1px solid #d2b48c;
            border-radius: 0.75rem;
            padding: 1rem;
            transition: all 0.2s ease;
            cursor: pointer;
            display: flex;
            flex-direction: column;
            text-decoration: none;
            color: inherit;
            height: 100%;
            min-height: 200px;
        }

        .author-card:hover {
            background: rgba(255, 255, 255, 0.5);
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(139, 69, 19, 0.2);
            text-decoration: none;
            color: inherit;
        }

        .author-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
            gap: 1rem;
        }

        .bio-text {
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
            text-overflow: ellipsis;
            line-height: 1.4;
            max-height: 4.2em;
            word-wrap: break-word;
            overflow-wrap: break-word;
        }

        .author-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
        }

        .limited-history-banner {
            background: linear-gradient(135deg, rgba(251, 191, 36, 0.2), rgba(245, 158, 11, 0.2));
            border: 2px solid #f59e0b;
            border-radius: 1rem;
            padding: 1.5rem;
            margin-bottom: 1.5rem;
        }

        .upgrade-button {
            background: linear-gradient(145deg, #f59e0b, #d97706);
            box-shadow: 
                inset 0 1px 0 rgba(255, 255, 255, 0.4),
                inset 0 -1px 0 rgba(0, 0, 0, 0.1),
                0 4px 12px rgba(245, 158, 11, 0.3);
            border: 2px solid #92400e;
            color: white;
            font-weight: 600;
            padding: 0.75rem 1.5rem;
            border-radius: 0.5rem;
            transition: all 0.3s ease;
            text-decoration: none;
            display: inline-block;
        }

        .upgrade-button:hover {
            background: linear-gradient(145deg, #d97706, #f59e0b);
            transform: translateY(-1px);
            text-decoration: none;
            color: white;
        }

        .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 1000;
            display: none;
            align-items: center;
            justify-content: center;
            padding: 1rem;
        }

        .modal-content {
            background: #f5e6d3;
            border: 3px solid #8b4513;
            border-radius: 1rem;
            width: 90vw;
            max-width: 900px;
            max-height: 80vh;
            display: flex;
            flex-direction: column;
            position: relative;
        }

        .modal-header {
            padding: 1.5rem;
            border-bottom: 2px solid #8b4513;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .modal-body {
            flex: 1;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }

        .modal-text {
            flex: 1;
            background: #1f2937;
            color: #10b981;
            font-family: 'Courier New', monospace;
            font-size: 0.875rem;
            min-height: 250px;
            padding: 1rem;
            overflow-y: auto;
            white-space: pre-wrap;
            word-wrap: break-word;
            border: none;
            resize: none;
        }

        .modal-footer {
            padding: 1rem 1.5rem;
            border-top: 2px solid #8b4513;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 1rem;
        }

        .close-button {
            background: none;
            border: none;
            font-size: 1.5rem;
            color: #8b4513;
            cursor: pointer;
            padding: 0.25rem;
            border-radius: 0.25rem;
            transition: background-color 0.2s;
        }

        .close-button:hover {
            background-color: rgba(139, 69, 19, 0.1);
        }

        .copy-button {
            background: linear-gradient(145deg, #deb887, #d2b48c);
            box-shadow: 
                inset 0 1px 0 rgba(255, 255, 255, 0.4),
                inset 0 -1px 0 rgba(0, 0, 0, 0.1),
                0 4px 12px rgba(139, 69, 19, 0.3);
            border: 2px solid #8b4513;
            color: #654321;
            font-weight: 600;
            padding: 0.5rem 1rem;
            border-radius: 0.5rem;
            transition: all 0.3s ease;
            cursor: pointer;
        }

        .copy-button:hover {
            background: linear-gradient(145deg, #d2b48c, #deb887);
            transform: translateY(-1px);
        }

        .loading-spinner {
            border: 2px solid #8b4513;
            border-top: 2px solid transparent;
            border-radius: 50%;
            width: 1rem;
            height: 1rem;
            animation: spin 1s linear infinite;
            display: inline-block;
            margin-right: 0.5rem;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        @media (max-width: 640px) {
            .author-grid {
                grid-template-columns: 1fr;
            }
        }

        @media (min-width: 641px) and (max-width: 1024px) {
            .author-grid {
                grid-template-columns: repeat(2, 1fr);
            }
        }

        @media (min-width: 1025px) {
            .author-grid {
                grid-template-columns: repeat(3, 1fr);
            }
        }
    </style>
</head>
<body class="text-amber-900">
    <main class="min-h-screen px-4 py-6">
        <div class="max-w-7xl mx-auto">
            <!-- Header -->
            <div class="text-center mb-8">
                <h1 class="latin-title mb-2">INTERACTION STATISTICS</h1>
                <p class="text-lg text-amber-700">@${username}'s Post Analysis</p>
                <a href="/dashboard" class="text-amber-600 hover:text-amber-800 underline mt-2 inline-block">← Back to Dashboard</a>
            </div>

            ${
              userStats &&
              !userStats.isPremium &&
              userStats.historyCount >= 2000
                ? `
            <!-- Limited History Banner -->
            <div class="limited-history-banner">
                <div class="flex items-center gap-4">
                    <div class="text-3xl">📚</div>
                    <div class="flex-1">
                        <h3 class="text-xl font-semibold text-amber-800 mb-2">Limited History View</h3>
                        <p class="text-amber-700 mb-3">
                            You're viewing stats from your first 2,000 posts. Upgrade to Premium to sync up to 100,000 historic posts 
                            for a complete interaction analysis with everyone you've engaged with.
                        </p>
                        <a href="/pricing" class="upgrade-button">
                            🚀 Upgrade to Premium
                        </a>
                    </div>
                </div>
            </div>
            `
                : ""
            }

            <div class="papyrus-card p-6">
                <h3 class="text-xl font-semibold mb-6 text-amber-800">Top Interactions by Post Count</h3>
                <div class="author-grid">
                    ${stats
                      .map(
                        (author, index) => `
                        <div class="author-card" onclick="openModal('${encodeURIComponent(
                          author.username
                        )}')">
                            <div class="author-content">
                                <div class="flex items-start gap-3 mb-3">
                                    <div class="text-lg font-bold text-amber-700 w-6 flex-shrink-0">#${
                                      index + 1
                                    }</div>
                                    <div class="flex-shrink-0">
                                        ${
                                          author.profileImageUrl
                                            ? `<img src="${author.profileImageUrl}" alt="${author.name}" class="w-12 h-12 rounded-full border-2 border-amber-700">`
                                            : `<div class="w-12 h-12 rounded-full bg-amber-200 border-2 border-amber-700 flex items-center justify-center">
                                                <span class="text-amber-700 font-bold">${author.name
                                                  .charAt(0)
                                                  .toUpperCase()}</span>
                                            </div>`
                                        }
                                    </div>
                                    <div class="flex-1 min-w-0">
                                        <div class="flex items-center gap-2 mb-1">
                                            <h4 class="font-semibold text-amber-800 truncate">${
                                              author.name
                                            }</h4>
                                            ${
                                              author.isVerified
                                                ? '<span class="text-blue-500 flex-shrink-0">✓</span>'
                                                : ""
                                            }
                                        </div>
                                        <p class="text-amber-600 text-sm truncate">@${
                                          author.username
                                        }</p>
                                    </div>
                                </div>
                                
                                ${
                                  author.bio
                                    ? `<p class="text-xs text-amber-700 mb-3 bio-text">${author.bio}</p>`
                                    : '<div class="mb-3"></div>'
                                }
                                
                                <div class="mt-auto">
                                    <div class="flex items-center justify-between mb-2">
                                        <div class="text-right">
                                            <div class="text-xl font-bold text-amber-700">${author.postCount.toLocaleString()}</div>
                                            <div class="text-xs text-amber-600">posts</div>
                                        </div>
                                        <div class="text-right">
                                            <div class="text-xs text-amber-500">
                                                ${new Date(
                                                  author.latestPostDate
                                                ).toLocaleDateString("en-US", {
                                                  month: "short",
                                                  day: "numeric",
                                                })}
                                            </div>
                                            <div class="text-xs text-amber-500">latest</div>
                                        </div>
                                    </div>
                                    
                                    ${
                                      author.location
                                        ? `<p class="text-xs text-amber-600 truncate">📍 ${author.location}</p>`
                                        : ""
                                    }
                                </div>
                            </div>
                        </div>
                    `
                      )
                      .join("")}
                </div>
                
                ${
                  stats.length === 0
                    ? `
                    <div class="text-center py-8">
                        <p class="text-amber-600">No interaction data available yet.</p>
                    </div>
                `
                    : ""
                }
            </div>
        </div>
    </main>

    <!-- Modal -->
    <div id="modal" class="modal-overlay">
        <div class="modal-content">
            <div class="modal-header">
                <h3 class="text-lg font-semibold text-amber-800">Conversations with <span id="modal-username"></span></h3>
                <button class="close-button" onclick="closeModal()">&times;</button>
            </div>
            <div class="modal-body">
                <textarea id="modal-text" class="modal-text" readonly></textarea>
            </div>
            <div class="modal-footer">
                <div class="text-sm text-amber-600">
                    <span id="loading-indicator" style="display: none;">
                        <span class="loading-spinner"></span>Loading posts...
                    </span>
                    <span id="content-info" style="display: none;"></span>
                </div>
                <button class="copy-button" onclick="copyToClipboard()">
                    📋 Copy to Clipboard
                </button>
            </div>
        </div>
    </div>

    <script>
        let currentContent = '';

        function openModal(username) {
            const modal = document.getElementById('modal');
            const modalUsername = document.getElementById('modal-username');
            const modalText = document.getElementById('modal-text');
            const loadingIndicator = document.getElementById('loading-indicator');
            const contentInfo = document.getElementById('content-info');
            
            modalUsername.textContent = '@' + decodeURIComponent(username);
            modalText.value = '';
            currentContent = '';
            
            // Show modal and loading
            modal.style.display = 'flex';
            loadingIndicator.style.display = 'inline';
            contentInfo.style.display = 'none';
            
            // Fetch the posts
            const query = 'from:' + decodeURIComponent(username);
            const url = '/search?' + new URLSearchParams({
                q: query,
                username: '${username}',
                maxTokens: '50000'
            });
            
            fetch(url)
                .then(response => {
                    if (!response.ok) {
                        throw new Error('Failed to fetch posts');
                    }
                    return response.text();
                })
                .then(content => {
                    currentContent = content;
                    modalText.value = content;
                    
                    // Hide loading and show content info
                    loadingIndicator.style.display = 'none';
                    contentInfo.style.display = 'inline';
                    
                    // Estimate content info
                    const tokens = Math.round(content.length/5);
                    contentInfo.textContent = \`\${tokens.toLocaleString()} tokens\`;
                })
                .catch(error => {
                    console.error('Error fetching posts:', error);
                    modalText.value = 'Error loading posts: ' + error.message;
                    loadingIndicator.style.display = 'none';
                    contentInfo.style.display = 'inline';
                    contentInfo.textContent = 'Error occurred';
                });
        }

        function closeModal() {
            const modal = document.getElementById('modal');
            modal.style.display = 'none';
        }

        function copyToClipboard() {
            if (currentContent) {
                navigator.clipboard.writeText(currentContent).then(() => {
                    const button = document.querySelector('.copy-button');
                    const originalText = button.textContent;
                    button.textContent = '✅ Copied!';
                    setTimeout(() => {
                        button.textContent = originalText;
                    }, 2000);
                }).catch(err => {
                    console.error('Failed to copy to clipboard:', err);
                    // Fallback: select text
                    const modalText = document.getElementById('modal-text');
                    modalText.select();
                });
            }
        }

        // Close modal when clicking outside
        document.getElementById('modal').addEventListener('click', function(e) {
            if (e.target === this) {
                closeModal();
            }
        });

        // Close modal with Escape key
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                closeModal();
            }
        });
    </script>
</body>
</html>`;

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
            font-size: clamp(1.5rem, 4vw, 2.25rem);
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

        .checkbox-container {
            background: rgba(255, 255, 255, 0.3);
            border: 2px solid #8b4513;
            border-radius: 0.75rem;
            padding: 1.5rem;
            margin: 1rem 0;
        }

        .loading-pulse {
            animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }

        @keyframes pulse {
            0%, 100% {
                opacity: 1;
            }
            50% {
                opacity: .5;
            }
        }

        .warning-card {
            background: rgba(252, 165, 165, 0.4);
            border: 2px solid #dc2626;
            border-radius: 0.75rem;
            padding: 1rem;
        }

        .ai-logo {
            width: 3rem;
            height: 3rem;
            border-radius: 0.5rem;
            transition: all 0.3s ease;
            filter: drop-shadow(2px 2px 4px rgba(139, 69, 19, 0.2));
            cursor: pointer;
        }

        .ai-logo:hover {
            transform: scale(1.1) translateY(-2px);
            filter: drop-shadow(4px 4px 8px rgba(139, 69, 19, 0.3));
        }

        .hidden {
            display: none;
        }

        .instructions-card {
            background: rgba(255, 255, 255, 0.5);
            border: 2px solid #8b4513;
            border-radius: 0.75rem;
            padding: 2rem;
            margin-top: 1rem;
        }

        .code-block {
            background: rgba(0, 0, 0, 0.8);
            color: #10b981;
            padding: 1rem;
            border-radius: 0.5rem;
            font-family: 'Courier New', monospace;
            font-size: 0.875rem;
            overflow-x: auto;
            margin: 0.5rem 0;
        }
    </style>
</head>
<body class="text-amber-900">
    <main class="min-h-screen px-4 py-6">
        <div class="max-w-4xl mx-auto">
            <!-- Header -->
            <div class="text-center mb-8">
                <h1 class="latin-title mb-2">GROK THYSELF</h1>
                <p class="text-lg text-amber-700">Nosce te ipsum per verba tua</p>
            </div>

            <!-- User Info & Stats Card -->
            <div class="papyrus-card p-6 mb-6">
                <div class="flex items-center gap-4 mb-4">
                    ${
                      user.profile_image_url
                        ? `<img src="${user.profile_image_url}" alt="Profile" class="w-12 h-12 rounded-full border-2 border-amber-700">`
                        : ""
                    }
                    <div class="flex-1">
                        <h2 class="text-xl font-bold text-amber-800">${
                          user.name
                        }</h2>
                        <p class="text-amber-600">@${user.username}</p>
                        ${
                          stats.isPremium
                            ? '<span class="inline-block bg-amber-200 text-amber-800 px-2 py-1 rounded-full text-sm font-semibold">Premium</span>'
                            : ""
                        }
                    </div>
                    
                    <!-- Stats in same card -->
                    <div class="grid grid-cols-2 gap-4 text-center">
                        <div>
                            <div class="text-2xl font-bold text-amber-700">${
                              stats.postCount
                            }</div>
                            <div class="text-sm text-amber-600">Posts</div>
                        </div>
                        <div>
                            <div class="text-2xl font-bold text-amber-700 ${
                              stats.scrapeStatus === "in_progress"
                                ? "loading-pulse"
                                : ""
                            }">
                                ${
                                  stats.historyIsCompleted && stats.syncedFrom
                                    ? "✓"
                                    : stats.scrapeStatus === "in_progress"
                                    ? "⟳"
                                    : stats.scrapeStatus === "failed"
                                    ? "✗"
                                    : "○"
                                }
                            </div>
                            <div class="text-sm text-amber-600">Status</div>
                        </div>
                    </div>
                </div>
                
                <div class="text-amber-700">
                    ${
                      stats.historyIsCompleted && stats.syncedFrom
                        ? "Your X content is fully synchronized and ready for AI analysis."
                        : stats.scrapeStatus === "in_progress"
                        ? "Synchronizing your X content... This may take a while."
                        : stats.scrapeStatus === "failed"
                        ? "Failed to sync your content. Please refresh to retry."
                        : "Ready to start synchronization."
                    }
                </div>
                ${
                  stats.syncedFrom || stats.syncedUntil
                    ? `<div class="text-sm text-amber-600 mt-2">
                        ${
                          stats.syncedFrom
                            ? `<div>Latest sync: ${new Date(
                                stats.syncedFrom
                              ).toLocaleDateString()}</div>`
                            : ""
                        }
                        ${
                          stats.syncedUntil && !stats.syncedFrom
                            ? `<div>Syncing until: ${new Date(
                                stats.syncedUntil
                              ).toLocaleDateString()}</div>`
                            : ""
                        }
                      </div>`
                    : ""
                }
            </div>

            ${
              stats.historyCount >= stats.historyMaxCount && !stats.isPremium
                ? `
            <!-- Warning Card for non-premium users at limit -->
            <div class="warning-card mb-6">
                <div class="flex items-center gap-3">
                    <span class="text-2xl">⚠️</span>
                    <div>
                        <h3 class="font-semibold text-red-800">Sync Limit Reached</h3>
                        <p class="text-red-700">You've reached the free tier limit (${stats.historyMaxCount} historic posts). Upgrade to continue syncing up to 100,000 posts.</p>
                        <a href="/pricing" class="text-red-800 underline font-semibold">Upgrade to Premium →</a>
                    </div>
                </div>
            </div>
            `
                : ""
            }

            <!-- MCP Installation Card -->
            <div class="papyrus-card p-6 mb-6">
                <h3 class="text-lg font-semibold mb-4 text-amber-800">Connect with Your AI Tools</h3>
                <p class="text-amber-700 mb-4">Choose your AI tool to get installation instructions:</p>
                
                <div class="flex flex-wrap justify-center gap-6 mb-4">
                    <img src="https://www.google.com/s2/favicons?domain=cursor.com&sz=64" 
                         alt="Cursor" class="ai-logo" data-provider="cursor">
                    <img src="https://www.google.com/s2/favicons?domain=code.visualstudio.com&sz=64" 
                         alt="VS Code" class="ai-logo" data-provider="vscode">
                    <img src="https://www.google.com/s2/favicons?domain=claude.ai&sz=64" 
                         alt="Claude" class="ai-logo" data-provider="claude">
                    <img src="https://www.google.com/s2/favicons?domain=codeium.com&sz=64" 
                         alt="Windsurf" class="ai-logo" data-provider="windsurf">
                    <img src="https://www.google.com/s2/favicons?domain=gemini.google.com&sz=64" 
                         alt="Gemini" class="ai-logo" data-provider="gemini">
                    <img src="https://www.google.com/s2/favicons?domain=chatgpt.com&sz=64" 
                         alt="ChatGPT" class="ai-logo bg-white p-2" data-provider="chatgpt">
                </div>

                <!-- Instructions for each provider (hidden by default) -->
                <div id="cursor-instructions" class="instructions-card hidden">
                    <h4 class="text-lg font-semibold text-amber-800 mb-3">Cursor Installation</h4>
                    <p class="text-amber-700 mb-3">Add to <code>~/.cursor/mcp.json</code> or <code>.cursor/mcp.json</code> (project-specific)</p>
                    <div class="code-block">
{
  "mcpServers": {
    "X History MCP": {
      "url": "https://grokthyself.com/mcp"
    }
  }
}
                    </div>
                    <a href="https://cursor.com/en/install-mcp?name=X%20History%20MCP&config=eyJ1cmwiOiJodHRwczovL2dyb2t0aHlzZWxmLmNvbS9tY3AifQ==" 
                       class="papyrus-button inline-block mt-3" target="_blank">🔗 Install via deep link</a>
                </div>

                <div id="vscode-instructions" class="instructions-card hidden">
                    <h4 class="text-lg font-semibold text-amber-800 mb-3">VS Code Installation</h4>
                    <p class="text-amber-700 mb-3">Add to VS Code settings.json</p>
                    <div class="code-block">
{
  "mcp": {
    "servers": {
      "X History MCP": {
        "type": "http",
        "url": "https://grokthyself.com/mcp"
      }
    }
  }
}
                    </div>
                    <a href="https://insiders.vscode.dev/redirect/mcp/install?name=X%20History%20MCP&config=%7B%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fgrokthyself.com%2Fmcp%22%7D" 
                       class="papyrus-button inline-block mt-3" target="_blank">🔗 Install via deep link</a>
                </div>

                <div id="claude-instructions" class="instructions-card hidden">
                    <h4 class="text-lg font-semibold text-amber-800 mb-3">Claude Desktop / Claude.ai Installation</h4>
                    <p class="text-amber-700 mb-3">Go to Settings → Connectors → Add Custom Connector and fill in:</p>
                    <ul class="text-amber-700 mb-3 list-disc list-inside">
                        <li><strong>Name:</strong> X History MCP</li>
                        <li><strong>URL:</strong> https://grokthyself.com/mcp</li>
                    </ul>
                    <p class="text-sm text-amber-600">Note: If you are part of an organisation, you may not have access to custom connectors. Ask your org administrator.</p>
                </div>

                <div id="windsurf-instructions" class="instructions-card hidden">
                    <h4 class="text-lg font-semibold text-amber-800 mb-3">Windsurf Installation</h4>
                    <p class="text-amber-700 mb-3">Add to your Windsurf MCP configuration</p>
                    <div class="code-block">
{
  "mcpServers": {
    "X History MCP": {
      "serverUrl": "https://grokthyself.com/mcp"
    }
  }
}
                    </div>
                </div>

                <div id="gemini-instructions" class="instructions-card hidden">
                    <h4 class="text-lg font-semibold text-amber-800 mb-3">Gemini CLI Installation</h4>
                    <p class="text-amber-700 mb-3">Add to <code>~/.gemini/settings.json</code></p>
                    <div class="code-block">
{
  "mcpServers": {
    "X History MCP": {
      "httpUrl": "https://grokthyself.com/mcp"
    }
  }
}
                    </div>
                </div>

                <div id="chatgpt-instructions" class="instructions-card hidden">
                    <h4 class="text-lg font-semibold text-amber-800 mb-3">ChatGPT Installation</h4>
                    <p class="text-amber-700 mb-3">First, go to 'Settings → Connectors → Advanced Settings' and turn on 'Developer Mode'.</p>
                    <p class="text-amber-700 mb-3">Then, in connector settings click 'create'. Fill in:</p>
                    <ul class="text-amber-700 mb-3 list-disc list-inside">
                        <li><strong>Name:</strong> X History MCP</li>
                        <li><strong>URL:</strong> https://grokthyself.com/mcp</li>
                        <li><strong>Authentication:</strong> OAuth</li>
                    </ul>
                    <p class="text-sm text-amber-600">Note: Developer Mode must be enabled and this feature may not be available for everyone.</p>
                </div>
            </div>

            <!-- Privacy Settings Card -->
            <div class="papyrus-card p-6 mb-6">
                <h3 class="text-lg font-semibold mb-4 text-amber-800">Privacy Settings</h3>
                <div class="checkbox-container">
                    <div class="space-y-4">
                        <label class="flex items-start gap-3 cursor-pointer">
                            <input type="checkbox" id="public-check" ${
                              stats.isPublic ? "checked" : ""
                            }
                                class="mt-1 w-5 h-5 text-amber-700 rounded focus:ring-amber-500">
                            <span class="text-amber-800">
                                Make my X data fully public so others can use it as AI connector
                            </span>
                        </label>

                        <label class="flex items-start gap-3 cursor-pointer">
                            <input type="checkbox" id="featured-check" ${
                              stats.isFeatured ? "checked" : ""
                            }
                                class="mt-1 w-5 h-5 text-amber-700 rounded focus:ring-amber-500">
                            <span class="text-amber-800">
                                Feature my profile so my X data can be more helpful to others
                            </span>
                        </label>
                    </div>
                </div>
            </div>

            <!-- Actions Card -->
            <div class="papyrus-card p-6 mb-6">
                <h3 class="text-lg font-semibold mb-4 text-amber-800">Actions</h3>
                <div class="grid md:grid-cols-2 gap-3">
                    <a href="/pricing" class="papyrus-button block text-center">Pricing</a>
                    <span onclick="window.location.href='/stats?username=${
                      user.username
                    }&maxTokens=10000&q='+(prompt('Search query (optional) - Supports keywords, from:username, before:YYYY-MM-DD, after:YYYY-MM-DD, AND/OR operators')||'')" class="papyrus-button block text-center cursor-pointer">Search Posts</span>
                    <a href="/stats?username=${
                      user.username
                    }" class="papyrus-button block text-center">Stats</a>
                    <a href="/logout" class="papyrus-button block text-center bg-red-200 hover:bg-red-300">Logout</a>
                </div>
            </div>
        </div>
    </main>

    <script>
        const publicCheck = document.getElementById('public-check');
        const featuredCheck = document.getElementById('featured-check');

        function updateSettings() {
            const params = new URLSearchParams();
            params.set('public', publicCheck.checked);
            params.set('featured', featuredCheck.checked);
            window.location.href = '/dashboard?' + params.toString();
        }

        publicCheck.addEventListener('change', updateSettings);
        featuredCheck.addEventListener('change', updateSettings);

        // Handle provider selection for MCP instructions
        const providers = document.querySelectorAll('.ai-logo[data-provider]');
        const instructionCards = document.querySelectorAll('[id$="-instructions"]');

        providers.forEach(provider => {
            provider.addEventListener('click', () => {
                const providerName = provider.getAttribute('data-provider');
                const targetCard = document.getElementById(providerName + '-instructions');
                
                // Hide all instruction cards
                instructionCards.forEach(card => {
                    card.classList.add('hidden');
                });
                
                // Show the selected card
                if (targetCard) {
                    targetCard.classList.remove('hidden');
                    targetCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }

                // Remove active state from all providers
                providers.forEach(p => {
                    p.style.border = '';
                });

                // Add active state to selected provider
                provider.style.border = '3px solid #8b4513';
            });
        });
    </script>
</body>
</html>`;

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
            headers: { "Content-Type": "text/html;charset=utf8" },
          });
        }

        if (url.pathname.endsWith("/admin")) {
          if (!ctx.authenticated) {
            return Response.redirect(url.origin + "/login", 302);
          }

          if (ctx.user.username !== ADMIN_USERNAME) {
            return new Response("Unauthorized", { status: 401 });
          }

          const username = url.pathname.split("/")[1];

          try {
            // Get user's Durable Object
            const userDO = env.USER_DO.get(
              env.USER_DO.idFromName(DO_NAME_PREFIX + username)
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

            // Handle query parameters for public/featured updates
            const isPublic = url.searchParams.get("public") === "true";
            const isFeatured = url.searchParams.get("featured") === "true";

            // Update database if query parameters are present
            if (
              url.searchParams.has("public") ||
              url.searchParams.has("featured")
            ) {
              let updateQuery = "UPDATE users SET ";
              const updateParams = [];
              const updateParts = [];

              if (url.searchParams.has("public")) {
                updateParts.push("is_public = ?");
                updateParams.push(isPublic ? 1 : 0);
              }

              if (url.searchParams.has("featured")) {
                updateParts.push("is_featured = ?");
                updateParams.push(isFeatured ? 1 : 0);
              }

              updateQuery +=
                updateParts.join(", ") +
                ", updated_at = CURRENT_TIMESTAMP WHERE id = ?";
              updateParams.push(ctx.user.id);

              await userDO.exec(updateQuery, ...updateParams);
            }

            // Get user stats (this will now include the updated values)
            const stats = await userDO.getUserStats(ctx.user);
            const dashboardHtml = dashboardPage(ctx.user, stats);

            return new Response(dashboardHtml, {
              headers: { "Content-Type": "text/html;charset=utf8" },
            });
          } catch (error) {
            console.error("Dashboard error:", error);
            return new Response("Error loading dashboard", { status: 500 });
          }
        }

        if (url.pathname === "/stripe-webhook") {
          return handleStripeWebhook(request, env);
        }
        if (url.pathname.endsWith("/sync")) {
          const username = url.pathname.split("/")[1];

          if (!ctx.user?.username) {
            return new Response("Unauthorized", { status: 401 });
          }

          const userDO = env.USER_DO.get(
            env.USER_DO.idFromName(DO_NAME_PREFIX + username)
          );

          const user = await userDO.ensureUserExists(username);
          // Start sync after payment
          await userDO.startSync(username);
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
              headers: { "Content-Type": "text/html;charset=utf8" },
            });
          } catch (error) {
            console.error("Pricing page error:", error);
            return new Response("Error loading pricing page", { status: 500 });
          }
        }

        if (url.pathname === "/stats") {
          const username =
            url.searchParams.get("username") || ctx.user?.username;

          if (!username) {
            return new Response("Unauthorized", { status: 401 });
          }

          try {
            // Get user's Durable Object
            const userDO = env.USER_DO.get(
              env.USER_DO.idFromName(DO_NAME_PREFIX + username)
            );

            // Get author stats
            const userStats = await userDO.getUserStats(ctx.user);
            const stats = await userDO.getAuthorStats(ctx.user?.username, 150);

            // Determine response format based on Accept header
            const acceptHeader = request.headers.get("accept") || "";
            const prefersPlainText = acceptHeader.includes("text/plain");
            const prefersMarkdown = acceptHeader.includes("text/markdown");
            const prefersHtml = acceptHeader.includes("text/html");

            // Return markdown if no accept header, or if plain/markdown is preferred over html
            const shouldReturnMarkdown =
              !acceptHeader ||
              (prefersPlainText && !prefersHtml) ||
              (prefersMarkdown && !prefersHtml) ||
              (!prefersHtml && (prefersPlainText || prefersMarkdown));

            if (shouldReturnMarkdown) {
              // Generate markdown response
              let markdown = `# Interaction Statistics - @${username}\n\n`;

              if (
                userStats &&
                !userStats.isPremium &&
                userStats.historyCount >= 2000
              ) {
                markdown += `## Limited History View\n\n`;
                markdown += `You're viewing stats from your first 2,000 posts. Upgrade to Premium to sync up to 100,000 historic posts for a complete interaction analysis.\n\n`;
                markdown += `[Upgrade to Premium →](https://grokthyself.com/pricing)\n\n`;
              }

              if (stats.length === 0) {
                markdown += `No interaction data available yet.\n`;
              } else {
                markdown += `## Top Interactions by Post Count\n\n`;

                stats.forEach((author, index) => {
                  markdown += `### ${index + 1}. @${author.username}\n\n`;
                  markdown += `**Name:** ${author.name}${
                    author.isVerified ? " ✓" : ""
                  }\n`;
                  markdown += `**Posts:** ${author.postCount.toLocaleString()}\n`;
                  markdown += `**Latest Post:** ${new Date(
                    author.latestPostDate
                  ).toLocaleDateString()}\n`;

                  if (author.bio) {
                    markdown += `**Bio:** ${author.bio}\n`;
                  }

                  if (author.location) {
                    markdown += `**Location:** ${author.location}\n`;
                  }

                  if (author.url) {
                    markdown += `**URL:** ${author.url}\n`;
                  }

                  markdown += `\n`;
                });
              }

              return new Response(markdown, {
                headers: {
                  "Content-Type": "text/markdown; charset=utf-8",
                  "Content-Disposition": `inline; filename="${username}-stats.md"`,
                },
              });
            } else {
              // Return HTML response
              const statsHtml = statsPage(username, stats, userStats);
              return new Response(statsHtml, {
                headers: { "Content-Type": "text/html;charset=utf8" },
              });
            }
          } catch (error) {
            console.error("Stats page error:", error);

            if (error.message === "User not found") {
              return new Response("User not found", { status: 404 });
            }

            if (error.message === "User did not make posts public") {
              return new Response("This user has not made their posts public", {
                status: 403,
              });
            }

            return new Response("Error loading stats page", { status: 500 });
          }
        }

        if (url.pathname === "/search") {
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
              url.searchParams.get("username") || ctx.user?.username;

            if (!username) {
              return new Response("Unauthorized", { status: 401 });
            }

            // Get user's Durable Object
            const userDO = env.USER_DO.get(
              env.USER_DO.idFromName(DO_NAME_PREFIX + username)
            );

            // Perform search
            const markdown = await userDO.searchPosts(ctx.user?.username, {
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
        }

        return new Response("Not found", { status: 404 });
      },
      { isLoginRequired: false, scope: "profile" }
    ),
    openapi,
    {
      authEndpoint: "/me",
      toolOperationIds: ["search", "stats"],
      serverInfo: { name: "Grok Thyself", version: "1.0.1" },
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
    apiVersion: "2025-09-30.clover",
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

    // Update balance, premium status, and history limits
    await userDO.exec(
      `UPDATE users SET 
        is_premium = 1, 
        balance = balance + ?, 
        history_max_count = ?
       WHERE username = ?`,
      amount_total,
      PREMIUM_MAX_HISTORIC_POSTS,
      username
    );

    // Start sync after payment
    await userDO.startSync(username);

    return new Response("Payment processed successfully", { status: 200 });
  }

  return new Response("Event not handled", { status: 200 });
}
