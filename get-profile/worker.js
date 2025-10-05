/*
Context:
https://uithub.com/janwilmake/gists/tree/main/named-codeblocks.md
https://uithub.com/janwilmake/twitterapi-openapi/blob/main/user-info.yaml

a worker that has one job, which is just to check the user-id, name, and image, for a given username, and caches that for 24 hours in KV. it requires secret env.BEARER_SECRET to be in Authorization bearer token. Simple username enrichment service. GET /{username} should return the JSON.

Server Basepath: https://profile.markdownfeed.com
*/

/**
 * Twitter user information object
 * @typedef {Object} TwitterUser
 * @property {string} id - The unique identifier of the user
 * @property {string} name - The display name of the user
 * @property {string} userName - The username of the Twitter user
 * @property {string} location - The user's location. for example: 東京の端っこ . may be empty
 * @property {string} url - The x.com URL of the user's profile
 * @property {string} description - The user's profile description
 * @property {boolean} isVerified - Whether the user has Twitter verification
 * @property {boolean} isBlueVerified - Whether the user has Twitter Blue verification
 * @property {string|null} verifiedType - The type of verification. eg. "government", can be empty
 * @property {number} followers - Number of followers
 * @property {number} following - Number of accounts following
 * @property {number} favouritesCount - Number of favorites
 * @property {number} statusesCount - Number of status updates
 * @property {number} mediaCount - Number of media posts
 * @property {string} createdAt - When the account was created. for example: Thu Dec 13 08:41:26 +0000 2007
 * @property {string} profilePicture - URL of the user's profile picture
 * @property {string} coverPicture - URL of the user's cover picture
 * @property {boolean} canDm - Whether the user can receive DMs
 * @property {boolean} isAutomated - Whether the account is automated
 * @property {string|null} automatedBy - The account that automated the account
 * @property {string[]} pinnedTweetIds - IDs of pinned tweets
 *
 * not found for initial test
 *
 * @property {boolean|undefined} hasCustomTimelines - Whether the user has custom timelines
 * @property {boolean|undefined} isTranslator - Whether the user is a translator
 * @property {string[]|undefined} withheldInCountries - Countries where the account is withheld
 * @property {Object|undefined} affiliatesHighlightedLabel - Affiliates highlighted label object
 * @property {boolean|undefined} possiblySensitive - Whether the account may contain sensitive content
 * @property {boolean|undefined} unavailable - Whether the account is unavailable
 * @property {string|undefined} message - The message of the account. eg. "This account is unavailable" or "This account is suspended"
 * @property {string|undefined} unavailableReason - The reason the account is unavailable. eg. "suspended"
 * @property {ProfileBio|undefined} profile_bio - Profile bio with entities
 */

/**
 * Profile bio with parsed entities
 * @typedef {Object} ProfileBio
 * @property {string} description - The bio description text
 * @property {ProfileBioEntities} entities - Parsed entities from the bio
 */

/**
 * Entities extracted from profile bio
 * @typedef {Object} ProfileBioEntities
 * @property {ProfileBioDescription} description - Description entities
 * @property {ProfileBioUrl} url - URL entities
 */

/**
 * Description entities from profile bio
 * @typedef {Object} ProfileBioDescription
 * @property {UrlEntity[]} urls - Array of URL entities found in description
 */

/**
 * URL entities from profile bio
 * @typedef {Object} ProfileBioUrl
 * @property {UrlEntity[]} urls - Array of URL entities found in URL field
 */

/**
 * URL entity with display and expanded information
 * @typedef {Object} UrlEntity
 * @property {string} display_url - Display URL
 * @property {string} expanded_url - Expanded URL
 * @property {number[]} indices - Start and end indices in the text
 * @property {string} url - Original URL
 */

export default {
  async fetch(request, env, ctx) {
    // Only allow GET requests
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }
    const url = new URL(request.url);

    // Check authorization
    const authHeader =
      request.headers.get("Authorization") ||
      `Bearer ${url.searchParams.get("secret")}`;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response("Unauthorized - Bearer token required", {
        status: 401,
      });
    }

    const token = authHeader.slice(7); // Remove 'Bearer ' prefix
    if (token !== env.BEARER_SECRET) {
      return new Response("Unauthorized - Invalid token", { status: 401 });
    }

    // Extract username from URL path
    const username = url.pathname.slice(1); // Remove leading slash

    if (!username) {
      return new Response("Username required in path", { status: 400 });
    }

    // Check if username has capital letters and redirect if needed
    const lowercaseUsername = username.toLowerCase();
    if (username !== lowercaseUsername) {
      const redirectUrl = new URL(request.url);
      redirectUrl.pathname = `/${lowercaseUsername}`;

      return new Response(null, {
        status: 302,
        headers: {
          Location: redirectUrl.toString(),
        },
      });
    }

    // Check cache first
    const cacheKey = `user:${username}`;
    /**
     *  @type {TwitterUser}
     */
    const cached = await env.KV.get(cacheKey);

    if (cached) {
      return new Response(cached, {
        headers: {
          "Content-Type": "application/json;charset=utf8",
          "X-Cache": "HIT",
        },
      });
    }

    try {
      // Fetch user info from TwitterAPI.io
      const twitterResponse = await fetch(
        `https://api.twitterapi.io/twitter/user/info?userName=${encodeURIComponent(
          username,
        )}`,
        {
          headers: {
            "X-API-Key": env.TWITTER_API_KEY,
          },
        },
      );

      if (!twitterResponse.ok) {
        return new Response(`Twitter API error: ${twitterResponse.status}`, {
          status: 502,
        });
      }

      const twitterData = await twitterResponse.json();

      // Check if the response indicates success
      if (twitterData.status !== "success" || !twitterData.data) {
        return new Response(
          JSON.stringify({
            error: "User not found",
            message: twitterData.msg || "User not found",
          }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      /**
       *  @type {TwitterUser}
       */
      const user = twitterData.data;
      // swap out normal pic for larger one
      user.profilePicture = user.profilePicture.replace("_normal", "_400x400");
      const responseBody = JSON.stringify(user, undefined, 2);

      // Cache for 24 hours (86400 seconds)
      await env.KV.put(cacheKey, responseBody, {
        expirationTtl: 86400,
      });

      return new Response(responseBody, {
        headers: {
          "Content-Type": "application/json;charset=utf8",
          "X-Cache": "MISS",
        },
      });
    } catch (error) {
      console.error("Error fetching user info:", error);
      return new Response(
        JSON.stringify({
          error: "Internal server error",
          message: "Failed to fetch user information",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  },
};
