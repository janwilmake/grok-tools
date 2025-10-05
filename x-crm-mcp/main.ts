/// <reference types="@cloudflare/workers-types" />
/// <reference lib="esnext" />

import { DurableObject } from "cloudflare:workers";
import { withSimplerAuth, UserContext } from "simplerauth-client";
import { withMcp } from "with-mcp";
//@ts-ignore
import html from "./homepage.html";
//@ts-ignore
import openapi from "./openapi.json";

export interface Env {
  CRMDURABLEOBJECT: DurableObjectNamespace<CrmDurableObject>;
  TWITTER_API_KEY: string;
}

// User's CRM data storage
export class CrmDurableObject extends DurableObject<Env> {
  sql: SqlStorage;
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.sql = state.storage.sql;
    this.env = env;
  }

  async initSchema() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS follows (
        user_id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        name TEXT,
        profile_image_url TEXT,
        description TEXT,
        followers_count INTEGER,
        following_count INTEGER,
        verified_type TEXT,
        is_blue_verified INTEGER,
        location TEXT,
        created_at TEXT,
        note TEXT,
        tags TEXT,
        synced_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        last_sync_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add tags column if it doesn't exist (for existing databases)
    try {
      this.sql.exec(`ALTER TABLE follows ADD COLUMN tags TEXT`);
    } catch (e) {
      // Column already exists, ignore error
    }
  }

  async getLastSyncTime(): Promise<Date | null> {
    await this.initSchema();
    const result = this.sql.exec(`
      SELECT last_sync_at FROM sync_log 
      ORDER BY last_sync_at DESC 
      LIMIT 1
    `);

    const rows = result.toArray();
    if (rows.length === 0) return null;

    return new Date(rows[0].last_sync_at as string);
  }

  async updateSyncTime() {
    await this.initSchema();
    this.sql.exec(
      `INSERT INTO sync_log (last_sync_at) VALUES (CURRENT_TIMESTAMP)`
    );
  }

  async syncFollows(username: string) {
    await this.initSchema();

    console.log(`Starting sync for user: ${username}`);

    // Update sync time at the start
    await this.updateSyncTime();

    // Store existing notes and tags before clearing
    const existingData = this.sql.exec(
      `SELECT username, note, tags FROM follows WHERE note IS NOT NULL OR tags IS NOT NULL`
    );
    const existingMap = new Map();
    for (const row of existingData.toArray()) {
      existingMap.set(row.username, { note: row.note, tags: row.tags });
    }

    // Clear existing follows
    this.sql.exec("DELETE FROM follows");
    console.log("Cleared existing follows");
    let follows = [];
    let totalFollows = 0;
    let cursor = null;
    let pageCount = 0;
    let data = undefined;
    do {
      pageCount++;
      const url = cursor
        ? `https://api.twitterapi.io/twitter/user/followings?userName=${username}&cursor=${cursor}`
        : `https://api.twitterapi.io/twitter/user/followings?userName=${username}`;

      console.log(`Fetching page ${pageCount}, cursor: ${cursor || "initial"}`);

      const response = await fetch(url, {
        headers: {
          "X-API-Key": this.env.TWITTER_API_KEY,
        },
      });

      if (!response.ok) {
        console.error(`API request failed with status ${response.status}`);
        throw new Error(`Failed to fetch follows: ${response.status}`);
      }

      data = await response.json();
      follows = data.followings || [];

      console.log(
        `Page ${pageCount}: Got ${follows.length} follows, has_next_page: ${data.has_next_page}, next_cursor: ${data.next_cursor}`
      );

      // Insert follows from this page
      for (const follow of follows) {
        const existing = existingMap.get(follow.userName);
        this.sql.exec(
          `INSERT OR REPLACE INTO follows 
           (user_id, username, name, profile_image_url, description, 
            followers_count, following_count, verified_type, is_blue_verified, 
            location, created_at, note, tags) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          follow.id,
          follow.userName,
          follow.name,
          follow.profile_image_url_https,
          follow.description,
          follow.followers_count,
          follow.following_count,
          follow.verifiedType,
          follow.verified ? 1 : 0,
          follow.location,
          follow.createdAt,
          existing?.note || null,
          existing?.tags || null
        );
      }

      totalFollows += follows.length;
      cursor = data.next_cursor;

      // Continue if we have more pages and got 200 results (indicating there might be more)
      // Also continue if has_next_page is true
    } while ((follows.length >= 200 || data.has_next_page) && cursor);

    console.log(
      `Sync completed: ${totalFollows} total follows across ${pageCount} pages`
    );
    return { synced: totalFollows, pages: pageCount };
  }

  async getFollows(tag?: string) {
    await this.initSchema();
    let query = `
      SELECT user_id, username, name, profile_image_url, description,
             followers_count, following_count, verified_type, is_blue_verified,
             location, created_at, note, tags, synced_at
      FROM follows 
    `;

    const params = [];
    if (tag) {
      query += ` WHERE tags LIKE ?`;
      params.push(`%${tag}%`);
    }

    query += ` ORDER BY followers_count DESC`;

    const result = this.sql.exec(query, ...params);
    return result.toArray();
  }

  async updateContact(username: string, note?: string, tags?: string) {
    await this.initSchema();
    const updates = [];
    const params = [];

    if (note !== undefined) {
      updates.push("note = ?");
      params.push(note);
    }

    if (tags !== undefined) {
      updates.push("tags = ?");
      params.push(tags);
    }

    if (updates.length === 0) {
      return { updated: false, error: "No updates provided" };
    }

    params.push(username);

    const result = this.sql.exec(
      `UPDATE follows SET ${updates.join(", ")} WHERE username = ?`,
      ...params
    );
    return { updated: result.rowsWritten > 0 };
  }

  async updateBulk(
    updates: Array<{ username: string; tags: string; note?: string }>
  ) {
    await this.initSchema();

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const update of updates) {
      try {
        const updateFields = [];
        const params = [];

        updateFields.push("tags = ?");
        params.push(update.tags);

        if (update.note !== undefined) {
          updateFields.push("note = ?");
          params.push(update.note);
        }

        params.push(update.username);

        const result = this.sql.exec(
          `UPDATE follows SET ${updateFields.join(", ")} WHERE username = ?`,
          ...params
        );

        if (result.rowsWritten > 0) {
          successCount++;
        } else {
          errorCount++;
          errors.push(`Username '${update.username}' not found`);
        }
      } catch (error) {
        errorCount++;
        errors.push(`Error updating '${update.username}': ${error.message}`);
      }
    }

    return {
      success: successCount,
      errors: errorCount,
      errorDetails: errors,
    };
  }

  async removeTag(tagToRemove: string) {
    await this.initSchema();

    // Get all follows with tags
    const result = this.sql.exec(
      `
      SELECT username, tags FROM follows 
      WHERE tags IS NOT NULL AND tags != '' AND tags LIKE ?
    `,
      `%${tagToRemove}%`
    );

    const followsWithTag = result.toArray();
    let updatedCount = 0;

    for (const follow of followsWithTag) {
      if (follow.tags) {
        // Split tags, remove the target tag (case insensitive), and rejoin
        const currentTags = (follow.tags as string)
          .split(",")
          .map((tag) => tag.trim())
          .filter((tag) => tag.toLowerCase() !== tagToRemove.toLowerCase());

        const newTags = currentTags.length > 0 ? currentTags.join(", ") : null;

        // Update the follow with new tags
        const updateResult = this.sql.exec(
          `UPDATE follows SET tags = ? WHERE username = ?`,
          newTags,
          follow.username
        );

        if (updateResult.rowsWritten > 0) {
          updatedCount++;
        }
      }
    }

    return {
      removed: updatedCount,
      tag: tagToRemove,
    };
  }

  async getUniqueTags(): Promise<string[]> {
    await this.initSchema();
    const result = this.sql.exec(`
      SELECT DISTINCT tags FROM follows 
      WHERE tags IS NOT NULL AND tags != ''
    `);

    const allTags = new Set<string>();
    for (const row of result.toArray()) {
      if (row.tags) {
        const tags = (row.tags as string).split(",").map((t) => t.trim());
        tags.forEach((tag) => allTags.add(tag));
      }
    }

    return Array.from(allTags).sort();
  }
}

export default {
  fetch: withMcp(
    withSimplerAuth(
      async (request: Request, env: Env, ctx: UserContext) => {
        const url = new URL(request.url);

        // Ensure required env vars
        if (!env.TWITTER_API_KEY) {
          return new Response("TWITTER_API_KEY not configured", {
            status: 500,
          });
        }

        // Get user's Durable Object
        const getUserDO = () => {
          if (!ctx.user?.id) {
            throw new Error("User not authenticated");
          }
          return env.CRMDURABLEOBJECT.get(
            env.CRMDURABLEOBJECT.idFromName(ctx.user.id)
          );
        };

        // Sync follows endpoint
        if (url.pathname === "/sync") {
          if (!ctx.authenticated) {
            return new Response("Authentication required", { status: 401 });
          }

          try {
            const userDO = getUserDO();

            // Check if sync is allowed
            const lastSync = await userDO.getLastSyncTime();
            const now = new Date();
            const twentyFourHoursAgo = new Date(
              now.getTime() - 24 * 60 * 60 * 1000
            );

            // Allow sync if no previous sync, last sync was >24h ago, or user is janwilmake
            const canSync =
              !lastSync ||
              lastSync < twentyFourHoursAgo ||
              ctx.user?.username === "janwilmake";

            if (!canSync) {
              const hoursUntilNextSync = Math.ceil(
                (lastSync.getTime() + 24 * 60 * 60 * 1000 - now.getTime()) /
                  (60 * 60 * 1000)
              );
              return new Response(
                JSON.stringify({
                  error: `Sync limited to once per 24 hours. Next sync available in ${hoursUntilNextSync} hours.`,
                  lastSync: lastSync.toISOString(),
                }),
                {
                  status: 429,
                  headers: { "Content-Type": "application/json" },
                }
              );
            }

            const result = await userDO.syncFollows(ctx.user?.username);

            return new Response(JSON.stringify(result), {
              headers: { "Content-Type": "application/json" },
            });
          } catch (error) {
            console.error("Sync error:", error);
            return new Response(JSON.stringify({ error: error.message }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }
        }

        // Get follows endpoint
        if (url.pathname === "/follows" && request.method === "GET") {
          if (!ctx.authenticated) {
            return new Response("Authentication required", { status: 401 });
          }

          try {
            const userDO = getUserDO();
            const tag = url.searchParams.get("tag");
            const follows = await userDO.getFollows(tag || undefined);
            const uniqueTags = await userDO.getUniqueTags();

            // If JSON requested
            if (request.headers.get("accept") === "application/json") {
              return new Response(JSON.stringify({ follows, uniqueTags }), {
                headers: { "Content-Type": "application/json" },
              });
            }

            // Return markdown format
            let output = "";

            if (uniqueTags.length > 0) {
              output += `**Tags:** ${uniqueTags.join(", ")}\n\n`;
            }

            output += follows
              .map(
                (x) =>
                  `- @${x.username} (${x.name}) ${x.location || ""} ${
                    x.tags ? `[${x.tags}] ` : ""
                  }${
                    x.note
                      ? `NOTE: ${x.note}`
                      : x.description
                      ? `*${x.description}*`
                      : ""
                  }`
              )
              .join("\n");

            return new Response(output);
          } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }
        }

        // Update contact endpoint
        if (url.pathname.startsWith("/contact/") && request.method === "POST") {
          if (!ctx.authenticated) {
            return new Response("Authentication required", { status: 401 });
          }

          const username = url.pathname.split("/contact/")[1];
          const note = url.searchParams.get("note");
          const tags = url.searchParams.get("tags");

          if (!username) {
            return new Response(
              JSON.stringify({ error: "Username required" }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              }
            );
          }

          try {
            const userDO = getUserDO();
            const result = await userDO.updateContact(username, note, tags);

            return new Response(JSON.stringify(result), {
              headers: { "Content-Type": "application/json" },
            });
          } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }
        }

        // Bulk update endpoint
        if (url.pathname === "/contacts/bulk" && request.method === "POST") {
          if (!ctx.authenticated) {
            return new Response("Authentication required", { status: 401 });
          }

          try {
            const body = await request.json();

            if (!Array.isArray(body.updates)) {
              return new Response(
                JSON.stringify({
                  error: "Request body must contain 'updates' array",
                }),
                {
                  status: 400,
                  headers: { "Content-Type": "application/json" },
                }
              );
            }

            const userDO = getUserDO();
            const result = await userDO.updateBulk(body.updates);

            return new Response(JSON.stringify(result), {
              headers: { "Content-Type": "application/json" },
            });
          } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }
        }

        // Remove tag endpoint
        if (url.pathname.startsWith("/tags/") && request.method === "DELETE") {
          if (!ctx.authenticated) {
            return new Response("Authentication required", { status: 401 });
          }

          const tag = decodeURIComponent(url.pathname.split("/tags/")[1]);

          if (!tag) {
            return new Response(JSON.stringify({ error: "Tag required" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          try {
            const userDO = getUserDO();
            const result = await userDO.removeTag(tag);

            return new Response(JSON.stringify(result), {
              headers: { "Content-Type": "application/json" },
            });
          } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }
        }

        // Auth check endpoint for MCP
        if (url.pathname === "/me" && request.method === "GET") {
          if (!ctx.authenticated) {
            return new Response("Authentication required", { status: 401 });
          }

          return new Response(
            JSON.stringify({
              user: ctx.user,
              authenticated: true,
            }),
            {
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        // Main page with HTML table view
        if (url.pathname === "/" && ctx.authenticated) {
          try {
            const userDO = getUserDO();
            const tag = url.searchParams.get("tag");
            const follows = await userDO.getFollows(tag || undefined);
            const uniqueTags = await userDO.getUniqueTags();

            const getSyncStatus = async () => {
              try {
                const lastSync = await userDO.getLastSyncTime();
                const now = new Date();
                const twentyFourHoursAgo = new Date(
                  now.getTime() - 24 * 60 * 60 * 1000
                );

                const canSync =
                  !lastSync ||
                  lastSync < twentyFourHoursAgo ||
                  ctx.user?.username === "janwilmake";

                return { canSync, lastSync };
              } catch (error) {
                console.error("Error getting sync status:", error);
                return null;
              }
            };

            const syncStatus = await getSyncStatus();

            return new Response(
              `
              <html>
                <head>
                  <title>X CRM</title>
                  <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 20px; }
                    .header { margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #eee; }
                    .tags { margin-bottom: 20px; }
                    .tag { 
                      display: inline-block; 
                      background: #f0f0f0; 
                      padding: 4px 8px; 
                      margin: 2px; 
                      border-radius: 4px; 
                      text-decoration: none; 
                      color: #333; 
                      font-size: 12px;
                    }
                    .tag:hover { background: #e0e0e0; }
                    .tag.active { background: #007acc; color: white; }
                    .clear-filter { color: #007acc; text-decoration: none; margin-left: 10px; }
                    table { border-collapse: collapse; width: 100%; }
                    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                    th { background-color: #f2f2f2; }
                    .profile-pic { width: 32px; height: 32px; border-radius: 50%; }
                    .verified { color: #1da1f2; }
                    .blue-verified { color: #007acc; }
                    .stats { font-size: 12px; color: #666; }
                    .note { background: #fff3cd; padding: 4px; border-radius: 4px; font-size: 12px; }
                    .tags-cell { font-size: 12px; }
                    .tags-cell .tag { font-size: 10px; }
                  </style>
                </head>
                <body>
                  <div class="header">
                    <h1>X CRM</h1>
                    <p>Welcome, ${
                      ctx.user.name
                    }! | <a href="/logout">Logout</a></p>
                    <p><a href="/follows">See follows in markdown</a></p>
                    ${
                      syncStatus?.canSync
                        ? `<p><a href="/sync">Sync Follows</a></p>`
                        : `<p>Sync available ${
                            syncStatus?.lastSync
                              ? "in " +
                                Math.ceil(
                                  (syncStatus.lastSync.getTime() +
                                    24 * 60 * 60 * 1000 -
                                    Date.now()) /
                                    (60 * 60 * 1000)
                                ) +
                                " hours"
                              : "soon"
                          }</p>`
                    }
                    <p>MCP endpoint (needed for editing): <code>${
                      url.origin
                    }/mcp</code></p>
                    <p><a target="_blank" href="https://installthismcp.com/X%20CRM?url=https%3A%2F%2Fcrm.grok-tools.com%2Fmcp"><img src="https://img.shields.io/badge/Install_MCP-X%20CRM-black?style=for-the-badge"></a></p>
                    <p><a href="https://x.com/janwilmake">Feedback / Contact</a></p>
                  </div>

                  ${
                    uniqueTags.length > 0
                      ? `
                    <div class="tags">
                      <strong>Filter by tag:</strong>
                      <a href="/" class="tag ${!tag ? "active" : ""}">All (${
                          follows.length
                        })</a>
                      ${uniqueTags
                        .map(
                          (t) =>
                            `<a href="?tag=${encodeURIComponent(
                              t
                            )}" class="tag ${
                              tag === t ? "active" : ""
                            }">${t}</a>`
                        )
                        .join("")}
                    </div>
                  `
                      : ""
                  }

                  ${
                    tag
                      ? `<p>Showing follows with tag: <strong>${tag}</strong> <a href="/" class="clear-filter">Clear filter</a></p>`
                      : ""
                  }

                  <table>
                    <thead>
                      <tr>
                        <th>Profile</th>
                        <th>Name</th>
                        <th>Stats</th>
                        <th>Location</th>
                        <th>Bio</th>
                        <th>Tags</th>
                        <th>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${follows
                        .map(
                          (follow) => `
                        <tr>
                          <td>
                            <img src="${
                              follow.profile_image_url || ""
                            }" class="profile-pic" onerror="this.style.display='none'">
                          </td>
                          <td>
                            <strong>@${follow.username}</strong><br>
                            ${follow.name || ""}
                            ${
                              follow.verified_type
                                ? `<span class="verified">✓</span>`
                                : ""
                            }
                            ${
                              follow.is_blue_verified
                                ? `<span class="blue-verified">✓</span>`
                                : ""
                            }
                          </td>
                          <td class="stats">
                            ${
                              follow.followers_count?.toLocaleString() || 0
                            } followers<br>
                            ${
                              follow.following_count?.toLocaleString() || 0
                            } following
                          </td>
                          <td>${follow.location || ""}</td>
                          <td style="max-width: 200px; font-size: 12px;">${
                            follow.description || ""
                          }</td>
                          <td class="tags-cell">
                            ${
                              follow.tags
                                ? follow.tags
                                    .split(",")
                                    .map((t) => t.trim())
                                    .map(
                                      (t) =>
                                        `<a href="?tag=${encodeURIComponent(
                                          t
                                        )}" class="tag">${t}</a>`
                                    )
                                    .join(" ")
                                : ""
                            }
                          </td>
                          <td>
                            ${
                              follow.note
                                ? `<div class="note">${follow.note}</div>`
                                : ""
                            }
                          </td>
                        </tr>
                      `
                        )
                        .join("")}
                    </tbody>
                  </table>

                  <p style="margin-top: 20px; color: #666; font-size: 12px;">
                    Total: ${follows.length} follows
                    ${tag ? ` with tag "${tag}"` : ""}
                  </p>
                </body>
              </html>
            `,
              {
                headers: { "Content-Type": "text/html;charset=utf8" },
              }
            );
          } catch (error) {
            console.error("Error loading follows:", error);
            return new Response("Error loading follows", { status: 500 });
          }
        }

        // Read the homepage.html file
        return new Response(html, {
          headers: { "Content-Type": "text/html;charset=utf8" },
        });
      },
      { isLoginRequired: false }
    ),
    openapi,
    {
      serverInfo: {
        name: "X CRM MCP Server",
        version: "1.0.0",
      },
      authEndpoint: "/me",
      toolOperationIds: [
        "getFollows",
        "updateContact",
        "updateBulk",
        "removeTag",
      ],
      promptOperationIds: [],
      resourceOperationIds: [],
    }
  ),
} satisfies ExportedHandler<Env>;
