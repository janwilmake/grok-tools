# Simple MCP for your own context

- Installation is MCP that has X OAuth
- Finds up to 100 historic posts of your username
- Upon one-time purchase ($99) it will index all of your history for private use
- Ability to purchase continuous updates for $20/month
- In settings, switch between public/private

Context I want for myself:

- all my posts and comments and the entire thread of these surrounding my comments/posts
- insights on the people I interact with most (we have this data, it's just a query)

How:

- https://uithub.com/janwilmake/universal-mcp-oauth/blob/main/simplerauth-client/README.md with x-oauth-provider for login
- https://github.com/janwilmake/with-mcp for mcp; tools:
  - `timeline({from,to,keywords})`
- Stripeflare for one-time purchase $99 to get user a balance

TODO:

- Build out POC
- Allow stripeflare as middleware with userID inserted
- When purchasing for $99 scrape until balance <0
