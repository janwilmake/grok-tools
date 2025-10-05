import {
  createClient,
  Env,
  stripeBalanceMiddleware,
  type StripeUser,
} from "stripeflare";
import { DORM } from "stripeflare";
const VERSION = "2";
//@ts-ignore
import indexHtml from "./index.html";

interface User extends StripeUser {
  historic_tweets_cursor: string | null;
  max_historic_tweets: number;
  recent_tweet_id: string | null;
  recent_tweet_at: string | null;
  twitter_username: string | null;
  twitter_user_id: string | null;
  twitter_name: string | null;
  twitter_followers_count: number | null;
  twitter_verified: boolean | null;
  last_active_at: string;
}

interface Post {
  id: string;
  user_access_token: string;
  tweet_id: string;
  tweet_created_at: string;
  full_text: string;
  author_id: string;
  author_screen_name: string;
  author_name: string;
  reply_count: number;
  retweet_count: number;
  favorite_count: number;
  quote_count: number;
  views_count: number;
  bookmark_count: number;
  is_quote_status: boolean;
  is_pinned: boolean;
  lang: string;
  source: string;
  in_reply_to_status_id: string | null;
  in_reply_to_user_id: string | null;
  in_reply_to_screen_name: string | null;
  created_at: string;
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
      historic_tweets_cursor TEXT,
      max_historic_tweets INTEGER DEFAULT 1000,
      recent_tweet_id TEXT,
      recent_tweet_at TEXT,
      twitter_username TEXT,
      twitter_user_id TEXT,
      twitter_name TEXT,
      twitter_followers_count INTEGER,
      twitter_verified BOOLEAN,
      last_active_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX idx_users_balance ON users(balance)`,
    `CREATE INDEX idx_users_name ON users(name)`,
    `CREATE INDEX idx_users_email ON users(email)`,
    `CREATE INDEX idx_users_verified_email ON users(verified_email)`,
    `CREATE INDEX idx_users_card_fingerprint ON users(card_fingerprint)`,
    `CREATE INDEX idx_users_client_reference_id ON users(client_reference_id)`,
    `CREATE INDEX idx_users_twitter_username ON users(twitter_username)`,
    `CREATE INDEX idx_users_twitter_user_id ON users(twitter_user_id)`,
    `CREATE INDEX idx_users_last_active_at ON users(last_active_at)`,
    `CREATE UNIQUE INDEX idx_users_twitter_username_unique ON users(twitter_username) WHERE twitter_username IS NOT NULL`,
    `CREATE TABLE posts (
      id TEXT PRIMARY KEY,
      user_access_token TEXT NOT NULL,
      tweet_id TEXT NOT NULL,
      tweet_created_at TEXT NOT NULL,
      full_text TEXT NOT NULL,
      author_id TEXT NOT NULL,
      author_screen_name TEXT NOT NULL,
      author_name TEXT NOT NULL,
      reply_count INTEGER DEFAULT 0,
      retweet_count INTEGER DEFAULT 0,
      favorite_count INTEGER DEFAULT 0,
      quote_count INTEGER DEFAULT 0,
      views_count INTEGER DEFAULT 0,
      bookmark_count INTEGER DEFAULT 0,
      is_quote_status BOOLEAN DEFAULT FALSE,
      is_pinned BOOLEAN DEFAULT FALSE,
      lang TEXT,
      source TEXT,
      in_reply_to_status_id TEXT,
      in_reply_to_user_id TEXT,
      in_reply_to_screen_name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_access_token) REFERENCES users (access_token)
    )`,
    `CREATE INDEX idx_posts_user_access_token ON posts(user_access_token)`,
    `CREATE INDEX idx_posts_tweet_id ON posts(tweet_id)`,
    `CREATE INDEX idx_posts_tweet_created_at ON posts(tweet_created_at)`,
    `CREATE INDEX idx_posts_author_id ON posts(author_id)`,
    `CREATE INDEX idx_posts_author_screen_name ON posts(author_screen_name)`,
    `CREATE INDEX idx_posts_created_at ON posts(created_at)`,
    `CREATE UNIQUE INDEX idx_posts_user_tweet ON posts(user_access_token, tweet_id)`,
  ],
};

interface SocialDataEnv extends Env {
  SOCIALDATA_API_KEY: string;
  SOCIALDATA_BASE_URL: string;
}

class SocialDataAPI {
  constructor(
    private apiKey: string,
    private baseUrl: string = "https://api.socialdata.tools",
  ) {}

  async getUserByUsername(username: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}/twitter/user/${username}`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to get user: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    return response.json();
  }

  async getUserTweets(userId: string, cursor?: string): Promise<any> {
    const url = new URL(`${this.baseUrl}/twitter/user/${userId}/tweets`);
    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to get tweets: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    return response.json();
  }
}

function sanitizeUsername(username: string): string {
  // Remove @ symbol if present and trim whitespace
  return username.replace(/^@/, "").trim().toLowerCase();
}

function validateUsername(username: string): boolean {
  // Twitter username validation: 1-15 characters, alphanumeric and underscore only
  const regex = /^[a-zA-Z0-9_]{1,15}$/;
  return regex.test(username);
}

async function handleSetUsername(
  request: Request,
  session: any,
  env: SocialDataEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await request.json();
    const { username } = body;

    if (!username || typeof username !== "string") {
      return new Response(JSON.stringify({ error: "Username is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const sanitizedUsername = sanitizeUsername(username);

    if (!validateUsername(sanitizedUsername)) {
      return new Response(
        JSON.stringify({
          error:
            "Invalid username format. Must be 1-15 characters, alphanumeric and underscore only",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const client = createClient({
      doNamespace: env.DORM_NAMESPACE,
      ctx,
      migrations,
      mirrorName: "aggregate",
      name: session.user.access_token,
      version: VERSION,
    });

    // Check if user already has a Twitter username set
    const currentUser = await client
      .exec<User>(
        "SELECT twitter_username FROM users WHERE access_token = ?",
        session.user.access_token,
      )
      .one()
      .catch(() => null);

    if (currentUser?.twitter_username) {
      return new Response(
        JSON.stringify({
          error: "Twitter username already set and cannot be changed",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Fetch Twitter user details
    const socialData = new SocialDataAPI(
      env.SOCIALDATA_API_KEY,
      env.SOCIALDATA_BASE_URL,
    );

    let twitterUser;
    try {
      twitterUser = await socialData.getUserByUsername(sanitizedUsername);
    } catch (error) {
      console.error("Error fetching Twitter user:", error);
      return new Response(
        JSON.stringify({
          error:
            "Failed to fetch Twitter user. Please check the username and try again.",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Update user with Twitter information
    const result = await client
      .exec(
        `UPDATE users SET 
         twitter_username = ?,
         twitter_user_id = ?,
         twitter_name = ?,
         twitter_followers_count = ?,
         twitter_verified = ?,
         last_active_at = CURRENT_TIMESTAMP
       WHERE access_token = ?`,
        sanitizedUsername,
        twitterUser.id_str,
        twitterUser.name,
        twitterUser.followers_count,
        twitterUser.verified,
        session.user.access_token,
      )
      .toArray();

    console.log({ result });

    // Return success with Twitter user details
    return new Response(
      JSON.stringify({
        success: true,
        twitter_user: {
          username: sanitizedUsername,
          user_id: twitterUser.id_str,
          name: twitterUser.name,
          followers_count: twitterUser.followers_count,
          verified: twitterUser.verified,
        },
      }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Set username error:", error);
    return new Response(JSON.stringify({ error: "Failed to set username" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function handleConfigUpdate(
  request: Request,
  session: any,
  env: SocialDataEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await request.json();
    const { max_historic_tweets } = body;

    if (
      typeof max_historic_tweets !== "number" ||
      max_historic_tweets < 0 ||
      max_historic_tweets > 10000
    ) {
      return new Response(
        JSON.stringify({
          error: "max_historic_tweets must be a number between 0 and 10000",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const client = createClient({
      doNamespace: env.DORM_NAMESPACE,
      ctx,
      migrations,
      mirrorName: "aggregate",
      name: session.user.access_token,
      version: VERSION,
    });

    await client
      .exec(
        "UPDATE users SET max_historic_tweets = ?, last_active_at = CURRENT_TIMESTAMP WHERE access_token = ?",
        max_historic_tweets,
        session.user.access_token,
      )
      .toArray();

    return new Response(
      JSON.stringify({ success: true, max_historic_tweets }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Config update error:", error);
    return new Response(JSON.stringify({ error: "Failed to update config" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function processUserTweets(
  user: User,
  env: SocialDataEnv,
  ctx: ExecutionContext,
): Promise<void> {
  if (!user.twitter_user_id) {
    console.log(`User ${user.access_token} has no Twitter user ID`);
    return;
  }

  const socialData = new SocialDataAPI(
    env.SOCIALDATA_API_KEY,
    env.SOCIALDATA_BASE_URL,
  );
  const client = createClient({
    doNamespace: env.DORM_NAMESPACE,
    ctx,
    migrations,
    mirrorName: "aggregate",
    name: user.access_token,
    version: VERSION,
  });

  let cursor = user.historic_tweets_cursor;
  let tweetsProcessed = 0;
  let foundRecentTweet = false;

  // First, get one tweet to check if we need to update
  try {
    const firstPage = await socialData.getUserTweets(user.twitter_user_id);

    if (!firstPage.tweets || firstPage.tweets.length === 0) {
      console.log(`No tweets found for user ${user.access_token}`);
      return;
    }

    const latestTweet = firstPage.tweets[0];

    // If this is the same as recent_tweet_id, no new tweets
    if (user.recent_tweet_id === latestTweet.id_str) {
      console.log(`No new tweets for user ${user.access_token}`);
      return;
    }

    // Process all pages until we find the recent tweet or hit max
    while (
      cursor !== null &&
      tweetsProcessed < user.max_historic_tweets &&
      !foundRecentTweet
    ) {
      const response = await socialData.getUserTweets(
        user.twitter_user_id,
        cursor,
      );

      if (!response.tweets || response.tweets.length === 0) {
        break;
      }

      for (const tweet of response.tweets) {
        if (user.recent_tweet_id === tweet.id_str) {
          foundRecentTweet = true;
          break;
        }

        // Insert tweet into posts table
        const post: Partial<Post> = {
          id: `${user.access_token}_${tweet.id_str}`,
          user_access_token: user.access_token,
          tweet_id: tweet.id_str,
          tweet_created_at: tweet.tweet_created_at,
          full_text: tweet.full_text,
          author_id: tweet.user.id_str,
          author_screen_name: tweet.user.screen_name,
          author_name: tweet.user.name,
          reply_count: tweet.reply_count || 0,
          retweet_count: tweet.retweet_count || 0,
          favorite_count: tweet.favorite_count || 0,
          quote_count: tweet.quote_count || 0,
          views_count: tweet.views_count || 0,
          bookmark_count: tweet.bookmark_count || 0,
          is_quote_status: tweet.is_quote_status || false,
          is_pinned: tweet.is_pinned || false,
          lang: tweet.lang,
          source: tweet.source,
          in_reply_to_status_id: tweet.in_reply_to_status_id_str,
          in_reply_to_user_id: tweet.in_reply_to_user_id_str,
          in_reply_to_screen_name: tweet.in_reply_to_screen_name,
        };

        try {
          await client
            .exec(
              `INSERT OR REPLACE INTO posts (
              id, user_access_token, tweet_id, tweet_created_at, full_text,
              author_id, author_screen_name, author_name, reply_count, retweet_count,
              favorite_count, quote_count, views_count, bookmark_count, is_quote_status,
              is_pinned, lang, source, in_reply_to_status_id, in_reply_to_user_id,
              in_reply_to_screen_name
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              post.id,
              post.user_access_token,
              post.tweet_id,
              post.tweet_created_at,
              post.full_text,
              post.author_id,
              post.author_screen_name,
              post.author_name,
              post.reply_count,
              post.retweet_count,
              post.favorite_count,
              post.quote_count,
              post.views_count,
              post.bookmark_count,
              post.is_quote_status,
              post.is_pinned,
              post.lang,
              post.source,
              post.in_reply_to_status_id,
              post.in_reply_to_user_id,
              post.in_reply_to_screen_name,
            )
            .toArray();

          tweetsProcessed++;
        } catch (error) {
          console.error(`Error inserting tweet ${tweet.id_str}:`, error);
        }
      }

      cursor = response.next_cursor;
    }

    // Update user with latest tweet info and cursor
    await client
      .exec(
        `UPDATE users SET 
         recent_tweet_id = ?, 
         recent_tweet_at = ?, 
         historic_tweets_cursor = ?
       WHERE access_token = ?`,
        latestTweet.id_str,
        latestTweet.tweet_created_at,
        cursor,
        user.access_token,
      )
      .toArray();

    console.log(
      `Processed ${tweetsProcessed} tweets for user ${user.access_token}`,
    );
  } catch (error) {
    console.error(
      `Error processing tweets for user ${user.access_token}:`,
      error,
    );
  }
}

export default {
  async fetch(
    request: Request,
    env: SocialDataEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    const result = await stripeBalanceMiddleware<User>(
      request,
      env,
      ctx,
      migrations,
      VERSION,
    );

    // If middleware returned a response (webhook or db api), return it directly
    if (result.response) {
      return result.response;
    }

    if (!result.session) {
      return new Response("Something went wrong", { status: 404 });
    }

    // Handle set username endpoint
    if (url.pathname === "/set-username") {
      return handleSetUsername(request, result.session, env, ctx);
    }

    // Handle config update endpoint
    if (url.pathname === "/config") {
      return handleConfigUpdate(request, result.session, env, ctx);
    }

    const user: User = result.session.user;

    // Update last_active_at
    const client = createClient({
      doNamespace: env.DORM_NAMESPACE,
      ctx,
      migrations,
      mirrorName: "aggregate",
      name: user.access_token,
      version: VERSION,
    });

    await client
      .exec(
        "UPDATE users SET last_active_at = CURRENT_TIMESTAMP WHERE access_token = ?",
        user.access_token,
      )
      .toArray();

    // Get fresh user data with Twitter info
    const freshUser = await client
      .exec<User>(
        "SELECT * FROM users WHERE access_token = ?",
        user.access_token,
      )
      .one()
      .catch(() => user);

    // Count archived posts
    const postCount = await client
      .exec<{ count: number }>(
        "SELECT COUNT(*) as count FROM posts WHERE user_access_token = ?",
        user.access_token,
      )
      .one()
      .then((result) => result?.count || 0)
      .catch(() => 0);

    // Prepare data for frontend
    const { access_token, verified_user_access_token, ...userData } = freshUser;
    const payment_link = env.STRIPE_PAYMENT_LINK;

    const windowData = {
      ...userData,
      payment_link,
      has_twitter_data: !!(
        freshUser.twitter_username && freshUser.twitter_user_id
      ),
      archived_posts_count: postCount,
    };

    // Inject data and return HTML
    const headers = new Headers(result.session.headers || {});
    headers.append("Content-Type", "text/html");

    const modifiedHtml = indexHtml.replace(
      "</head>",
      `<script>window.data = ${JSON.stringify(windowData)};</script></head>`,
    );

    return new Response(modifiedHtml, { headers });
  },

  async scheduled(
    controller: ScheduledController,
    env: SocialDataEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    const client = createClient({
      doNamespace: env.DORM_NAMESPACE,
      ctx,
      migrations,
      name: "aggregate",
      version: VERSION,
    });

    let users: User[] = [];

    // Determine which users to update based on cron schedule
    switch (controller.cron) {
      case "* * * * *": // Every minute - users active in last hour
        users = await client
          .exec<User>(
            `SELECT * FROM users 
           WHERE twitter_user_id IS NOT NULL 
           AND datetime(last_active_at) > datetime('now', '-1 hour')
           ORDER BY last_active_at DESC
           LIMIT 100`,
          )
          .toArray();
        break;

      case "0 * * * *": // Every hour - users active in last day
        users = await client
          .exec<User>(
            `SELECT * FROM users 
           WHERE twitter_user_id IS NOT NULL 
           AND datetime(last_active_at) > datetime('now', '-1 day')
           AND datetime(last_active_at) <= datetime('now', '-1 hour')
           ORDER BY last_active_at DESC
           LIMIT 500`,
          )
          .toArray();
        break;

      case "0 0 * * *": // Every day - all other users
        users = await client
          .exec<User>(
            `SELECT * FROM users 
           WHERE twitter_user_id IS NOT NULL 
           AND datetime(last_active_at) <= datetime('now', '-1 day')
           ORDER BY last_active_at DESC
           LIMIT 1000`,
          )
          .toArray();
        break;
    }

    console.log(
      `Processing ${users.length} users for cron: ${controller.cron}`,
    );

    // Process users in batches to avoid timeouts
    const batchSize = 10;
    for (let i = 0; i < users.length; i += batchSize) {
      const batch = users.slice(i, i + batchSize);

      await Promise.allSettled(
        batch.map((user) => processUserTweets(user, env, ctx)),
      );

      // Small delay between batches
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  },
};

export { DORM };
