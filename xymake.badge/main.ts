/** must have real token count by streaming in cloudflare, and 1w cache*/
const getTokenCount = async (xymakeUrl: string, credentials: string) => {
  // TODO: add caching for this, also, this key could expire, also, could expose my private repos
  const response = await fetch(xymakeUrl, {
    headers: {
      Accept: `text/markdown`,
      //  Authorization: `Bearer ${credentials}`,
    },
  });

  if (response.status !== 404 && !response.ok) {
    console.log({ status: response.status, text: await response.text() });
    return "api_error";
  }

  if (response.status === 404) {
    return "thread_not_found";
  }

  try {
    const text: any = await response.text();
    const count = Math.round(text.length / 5);
    const countString =
      count > 200000
        ? String(Math.round(count / 100000) / 10) + "M"
        : count > 5000
        ? String(Math.round(count / 1000)) + "k"
        : String(count);

    return countString + "_tokens";
  } catch (e) {
    return "thread_not_found";
  }
};

const returnBadge = (text: string, tokens: string, color: string = "black") => {
  const badgeUrl = `https://img.shields.io/badge/${text.replaceAll(
    " ",
    "_",
  )}-${tokens}-${color}`;
  return fetch(badgeUrl);
};

// CORS headers object for reuse
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  fetch: async (request: Request, env: any) => {
    // Handle preflight OPTIONS request
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: { ...corsHeaders, "Access-Control-Max-Age": "86400" },
      });
    }

    // TODO: collect thread view locations too
    const url = new URL(request.url);

    // Custom label from query param, default to "Thread"
    const label = url.searchParams.get("label") || "X Thread";

    const [username, statusPath, statusId] = url.pathname.slice(1).split("/");

    if (!username || statusPath !== "status" || !statusId) {
      return returnBadge(label, "invalid");
    }

    // Keep all other query params except 'label'
    const queryParams = new URLSearchParams(url.searchParams);
    queryParams.delete("label");

    const xymakeUrl = `https://xymake.com/${username}/status/${statusId}${
      queryParams.size ? `?${queryParams.toString()}` : ""
    }`;
    const tokensString = await getTokenCount(xymakeUrl, env.CREDENTIALS);

    return returnBadge(label, tokensString);
  },
};
