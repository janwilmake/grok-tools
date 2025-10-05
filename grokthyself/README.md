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
  - `timeline({q})`
- Stripeflare for one-time purchase $99 to get user a balance

TODO:

- ✅ Build out POC
- Allow stripeflare as middleware with userID inserted.
- Ensure initial scrape works well by ensuring it does NOT time out
- After purchase, do follow-up scrape that gets all your data. SHOULD NOT FAIL.
- Cronjob every day that gets everything until 48h ago, including full thread.
- Have a limit to how long thread can be (otherwise it can become too expensive for big accounts)
- Fix links and media in the posts
- Configuration to make your own AI public or invite specific people
- Add MCP installation button (installthismcp: link to https://grokthyself.com/{username}/mcp)
- Expose the MCP (after login, only allow if username matches)
- For free users, put payment URL in every response.

I can build this and make it a real app within a week. I can give this away for free to some friends, and discount price on premium one from $129 to $49 temporarily.
