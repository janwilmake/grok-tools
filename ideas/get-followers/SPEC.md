https://x.stripeflare.com
https://httpspastebincon-vb8h080.letmeprompt.com/result (base path: api.twitterapi.io)

Use x.stripeflare.com for a new app to be deployed on xfollows.markdownfeed.com that:

- has beautiful landingpage at '/'
- has dashboard after login that shows curl with access_token to retrieve a markdown of all users they are following
- requires a payment of $20 after login. webhook verifies user has 20+ balance, then KV /{username} is set to loading. then, in ctx.waitUntil, the twitterapi is used to get all follows, convert into markdown, and store in a KV with key /{username}
- expose KV value at /{username}

Technical details:

- never use `Response.redirect`, always `new Response`.
- use `Headers.append("Set-Cookie", value)` (beware that `response.headers.append` will fail) to set a Lax cookie (valid 90 days) that contains access_token
- also allow authorization bearer token to be alternative location of the access_token

make me this cloudflare JS worker using `export default { fetch }` syntax. use JS-doc-comments
