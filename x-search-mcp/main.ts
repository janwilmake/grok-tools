import { withMcp } from "with-mcp";
//@ts-ignore
import openapi from "./openapi.json";

export default {
  fetch: withMcp(
    async (request) => {
      const url = new URL(request.url);
      const headerApiKey = request.headers.get("x-api-key");
      const queryApiKey = url.searchParams.get("apiKey");
      const apiKey = headerApiKey || queryApiKey;

      if (!apiKey) {
        return new Response(
          JSON.stringify({
            error: 400,
            message:
              "No API key provided. Please add x-api-key header or apiKey query parameter.",
            status: "error",
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      try {
        const response = await fetch(
          "https://api.twitterapi.io" + url.pathname + url.search,
          {
            method: request.method,
            body: request.body,
            headers: {
              "x-api-key": apiKey,
            },
          }
        );

        const data = await response.json();

        // Handle error responses
        if (!response.ok) {
          return new Response(
            JSON.stringify({
              error: response.status,
              message:
                data.message ||
                `HTTP ${response.status}: ${response.statusText}`,
              status: "error",
            }),
            {
              status: response.status,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        // Check if this is the searchTweetsAdvanced endpoint
        if (url.pathname === "/twitter/tweet/advanced_search") {
          const markdownResult = formatTweetsAsMarkdown(data);
          return new Response(markdownResult, {
            status: 200,
            headers: { "Content-Type": "text/markdown" },
          });
        }

        // For other endpoints, return JSON as-is
        return new Response(JSON.stringify(data), {
          status: response.status,
          headers: { "Content-Type": "application/json" },
        });
      } catch (error) {
        return new Response(
          JSON.stringify({
            error: 500,
            message: `Request failed: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
            status: "error",
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
    },
    openapi,
    {
      toolOperationIds: ["searchTweetsAdvanced"],
    }
  ),
};

function formatTweetsAsMarkdown(data: any): string {
  if (!data.tweets || data.tweets.length === 0) {
    return `# Search Results\n\nNo tweets found.\n\n**Has Next Page:** ${
      data.has_next_page || false
    }\n**Cursor:** ${data.next_cursor || "N/A"}`;
  }

  let markdown = `# Search Results (${data.tweets.length} tweets)\n\n`;

  data.tweets.forEach((tweet: any, index: number) => {
    const author = tweet.author;
    const createdAt = new Date(tweet.createdAt).toLocaleString();

    markdown += `## Tweet ${index + 1}\n`;
    markdown += `**@${author.userName}** (${author.name})${
      author.isBlueVerified ? " ✓" : ""
    }\n`;
    markdown += `*${createdAt}* | [View Tweet](${tweet.url})\n\n`;

    // Tweet text
    markdown += `${tweet.text}\n\n`;

    // Engagement metrics in compact format
    const metrics = [
      `❤️ ${tweet.likeCount || 0}`,
      `🔄 ${tweet.retweetCount || 0}`,
      `💬 ${tweet.replyCount || 0}`,
      `👁️ ${tweet.viewCount || 0}`,
    ].filter((m) => !m.includes(" 0")); // Only show non-zero metrics

    if (metrics.length > 0) {
      markdown += `**Engagement:** ${metrics.join(" | ")}\n\n`;
    }

    // Entities (hashtags, mentions, URLs) in compact format
    if (tweet.entities) {
      const entities = [];

      if (tweet.entities.hashtags?.length > 0) {
        const hashtags = tweet.entities.hashtags
          .map((h: any) => `#${h.text}`)
          .join(" ");
        entities.push(`**Tags:** ${hashtags}`);
      }

      if (tweet.entities.user_mentions?.length > 0) {
        const mentions = tweet.entities.user_mentions
          .map((m: any) => `@${m.screen_name}`)
          .join(" ");
        entities.push(`**Mentions:** ${mentions}`);
      }

      if (tweet.entities.urls?.length > 0) {
        const urls = tweet.entities.urls
          .map((u: any) => `[${u.display_url}](${u.expanded_url})`)
          .join(" ");
        entities.push(`**Links:** ${urls}`);
      }

      if (entities.length > 0) {
        markdown += `${entities.join(" | ")}\n\n`;
      }
    }

    // Quote tweet or retweet info
    if (tweet.quoted_tweet) {
      markdown += `> **Quoting @${
        tweet.quoted_tweet.author.userName
      }:** ${tweet.quoted_tweet.text.substring(0, 100)}${
        tweet.quoted_tweet.text.length > 100 ? "..." : ""
      }\n\n`;
    }

    if (tweet.retweeted_tweet) {
      markdown += `> **RT @${
        tweet.retweeted_tweet.author.userName
      }:** ${tweet.retweeted_tweet.text.substring(0, 100)}${
        tweet.retweeted_tweet.text.length > 100 ? "..." : ""
      }\n\n`;
    }

    // Reply info
    if (tweet.isReply && tweet.inReplyToUsername) {
      markdown += `*Replying to @${tweet.inReplyToUsername}*\n\n`;
    }

    markdown += `---\n\n`;
  });

  // Pagination info
  markdown += `## Pagination\n`;
  markdown += `**Has Next Page:** ${data.has_next_page}\n`;
  if (data.has_next_page && data.next_cursor) {
    markdown += `**Next Cursor:** \`${data.next_cursor}\`\n`;
  }

  return markdown;
}
