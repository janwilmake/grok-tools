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

- ❌ Allow stripeflare as middleware with userID inserted.
- ✅ Simpler stripe setup with webhook parsing and a payment link with username
- ✅ Ensure initial scrape works well by ensuring it does NOT time out. This can be done using an alarm
- ✅ After purchase, do follow-up scrape that gets all your data. SHOULD NOT FAIL or time out. We can do this by keeping track of `synced_from`

# Misc

- Fix links and media in the posts,
- Add profile image of author
- Configuration to make your own AI public (can be checkbox at startup)

# Main Interactions

- Make available `/USERNAME/stats` with other indexed people sorted by # of posts: `SELECT author_username, COUNT(*) as post_count FROM posts GROUP BY author_username ORDER BY post_count DESC;`
- Add this into dashboard with easy click to retrieve all of the user that we have. This is a nice context for your overlap with someone.

What's the most valuable? I guess a full context over my top N people is super valuable!!!!! Also generally, a way to show

Imagine a chat with janwilmake that knows his top 50 interactions very well, allowing it to use tool of another person context!

# Fix sync

- If last sync is >24 ago or never (see: `synced_until`), perform sync in background. That gets everything until 24h before last sync, including full thread.
- For free users, put payment URL in every response.

After I have this, it's already something I can use together with parallel tasks. I can build this and make it a real app within a week. I can give this away for free to some friends, and discount price on premium one from $129 to $49 temporarily.

# MCP

- ✅ Add MCP installation button (installthismcp: link to https://grokthyself.com/{username}/mcp)
- ✅ Expose the MCP (after login, only allow if username matches)
- Update package to allow using `mcpHandler` directly with prefilled variable from path, then offer an MCP for anyone
- Add main interactions to main context, top-N filter on search

# Limit large accounts

- Add admin testing to sync accounts for free
- Have a limit to how long thread can be (otherwise it can become too expensive for big accounts)

# Minibenchmark

- simple benchmark: ask questions about your friends people were asking grok a while ago for fun. vibe benchmark grok vs. grokthyself. put on landing.

# Chat Completions

This is literally gold if done well. It should never halucinate and always stay w'in bounds of truth. People must be able to chat with it over my DMs if I don't reply. This is literally epic!
