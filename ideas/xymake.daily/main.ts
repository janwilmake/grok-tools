/// <reference types="@cloudflare/workers-types" />

/**
 * Cloudflare Worker with scheduled daily task and queue
 * - Daily schedule fetches users from xymake.com
 * - Queue processes each user to fetch their data
 */

export interface Env {
  // KV Namespace for storing tweet data
  TWEET_KV: KVNamespace;
  // Queue for processing users
  xymake_queue: Queue;
  CREDENTIALS: string;
}

// Type for user data
interface UserWithReplies {
  url: string;
}

const queueUsers = async (env: Env) => {
  try {
    // Fetch the list of users
    const response = await fetch("https://xymake.com/users.json");

    if (!response.ok) {
      throw new Error(
        `Failed to fetch users: ${response.status} ${response.statusText}`,
      );
    }

    const users = (await response.json()) as string[];
    console.log(`Processing ${users.length} users`);

    // Queue each user for processing
    for (const username of users) {
      await env.xymake_queue.send({ username });
      console.log(`Queued user: ${username}`);
    }
  } catch (error) {
    console.error("Error in scheduled job:", error);
  }
};
// Daily scheduled handler
export default {
  // Handle HTTP requests
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (env.CREDENTIALS === url.searchParams.get("secret")) {
      await queueUsers(env);
      return new Response("Running schedule now. tail it!");
    }
    return new Response(
      "Worker is running. Check logs for schedule and queue processing.",
      {
        headers: { "Content-Type": "text/plain" },
      },
    );
  },

  // Scheduled daily job
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    console.log("Daily schedule triggered at", event.scheduledTime);
    await queueUsers(env);
  },

  // Queue consumer
  async queue(batch: MessageBatch<any>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const { username } = message.body;
      console.log(`Processing user: ${username}`);

      try {
        // Fetch user data with replies
        const userDataResponse = await fetch(
          `https://xymake.com/${username}/with_replies.json`,
        );

        if (!userDataResponse.ok) {
          throw new Error(
            `Failed to fetch data for ${username}: ${userDataResponse.status}`,
          );
        }

        const userData = (await userDataResponse.json()) as UserWithReplies[];
        console.log(`Found ${userData.length} URLs for ${username}`);

        // Fetch content for each URL
        const contentMap: Record<string, string> = {};

        const MAX_PER_USER = 25;
        // Process URLs in parallel with a limit of 5 concurrent requests
        const urlChunks = chunkArray(
          userData.reverse().slice(0, MAX_PER_USER),
          5,
        );

        for (const chunk of urlChunks) {
          const promises = chunk.map(async (item) => {
            try {
              const contentResponse = await fetch(item.url);

              if (!contentResponse.ok) {
                console.warn(
                  `Failed to fetch ${item.url}: ${contentResponse.status}`,
                );
                return { url: item.url, content: null };
              }

              const content = await contentResponse.text();
              return { url: item.url, content };
            } catch (error) {
              console.error(`Error fetching ${item.url}:`, error);
              return { url: item.url, content: null };
            }
          });

          const results = await Promise.all(promises);

          // Add successful results to the content map
          for (const result of results) {
            if (result.content !== null) {
              contentMap[result.url] = result.content;
            }
          }
        }

        console.log({ contentMap });
        // Store the aggregated data in KV
        const key = `daily/${username}`;
        await env.TWEET_KV.put(key, JSON.stringify(contentMap));
        console.log(
          `Stored data for ${username} with ${
            Object.keys(contentMap).length
          } items`,
        );
      } catch (error) {
        console.error(`Error processing ${username}:`, error);
      }
    }
  },
};

// Helper function to chunk array into smaller arrays
function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}
