# Simple MCP for your own context

- Installation is MCP that has X OAuth
- Finds up to 100 historic posts of your username
- Upon one-time purchase ($99) it will index all of your history for private use
- Ability to purchase continuous updates for $20/month
- In settings, switch between public/private

Context I want for myself:

- all my posts and comments and the entire thread of these surrounding my comments/posts
- Insights on the people I interacted with most (we have this data, it's just a query)

How:

- https://uithub.com/janwilmake/universal-mcp-oauth/blob/main/simplerauth-client/README.md with x-oauth-provider for login
- https://github.com/janwilmake/with-mcp for mcp; tools:
  - `timeline({q})`
- Stripeflare for one-time purchase $99 to get user a balance

# TODO:

- ✅ Build out POC

# Add monetization and daily update for premium users

- Allow stripeflare as middleware with userID inserted.
- Ensure initial scrape works well by ensuring it does NOT time out
- After purchase, do follow-up scrape that gets all your data. SHOULD NOT FAIL.
- Cronjob in background based on `last_synced_at`, that gets everything until 24h before last sync, including full thread.
- For free users, put payment URL in every response.

After I have this, it's already something I can use together with parallel tasks.

# MCP

- ✅ Add MCP installation button (installthismcp: link to https://grokthyself.com/{username}/mcp)
- ✅ Expose the MCP (after login, only allow if username matches)
- Update package to allow using `mcpHandler` directly with prefilled variable from path, then offer an MCP for anyone

# Misc

- Fix links and media in the posts
- Configuration to make your own AI public

# Limit large accounts

- Add admin testing to sync accounts for free
- Have a limit to how long thread can be (otherwise it can become too expensive for big accounts)

# Main Interactions

- Make available `/USERNAME/stats` with other indexed people sorted by # of posts
- Add this into dashboard with easy click to retrieve all of the user that we have. This is a nice context for your overlap with someone.
- Create SVG with the 2 profile pictures in circles, turn this into PNG.

I can build this and make it a real app within a week. I can give this away for free to some friends, and discount price on premium one from $129 to $49 temporarily.
