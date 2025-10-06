# First version (2025-10-05)

- ✅ Build out POC
- ❌ Allow stripeflare as middleware with userID inserted.
- ✅ Simpler stripe setup with webhook parsing and a payment link with username
- ✅ Ensure initial scrape works well by ensuring it does NOT time out. This can be done using an alarm
- ✅ After purchase, do follow-up scrape that gets all your data. SHOULD NOT FAIL or time out. We can do this by keeping track of `synced_from`
- ✅ Fix links and media in the posts
- ✅ Surface profile image of author
- ✅ Configuration to make your own AI public (also can be checkbox at startup)
- ✅ Make available `/USERNAME/stats` with other indexed people sorted by # of posts: `SELECT author_username, COUNT(*) as post_count FROM posts GROUP BY author_username ORDER BY post_count DESC;`
- ✅ Add this into dashboard with easy click to retrieve all of the user that we have. This is a nice context for your overlap with someone.
- ✅ Add MCP installation button (installthismcp: link to https://grokthyself.com/{username}/mcp)
- ✅ Expose the MCP (after login, only allow if username matches)

## Fix sync

- ✅ Contacted Kaito to ask about API recommendation
- 🤔 Maybe use advanced_search to not rely on cursor: `from:janwilmake since:2025-10-05 until:2025-10-07` just do this with `until` flag if we continue. The added advantage is we can potentially paralellize this much more using a parallel queue for the querying, using the DOs only for writing to the DB.

✅ Sync needs to be improved. Let's

- `history_max_count` (defaults to 1000, gets set to 100000 after purchase of premium)
- `history_cursor` (cursor for doing backfill)
- `history_count` (total posts (including thread posts) in history. does not count frontfill posts)
- `history_is_completed: 0|1` gets set to 1 after cursor doesn't respond with more tweets
- `synced_from` (date of latest post scraped for a completed sync. will get set if no history sync is needed, and we're doing a frontfill sync. will keep going with sync until 24h before this date, then set this value to the value of `synced_until`)
- `synced_from_cursor` (cursor used for frontfill sync)
- `synced_until` (used for frontload: gets set when a new sync starts to the current date)
- `is_premium: 0|1` (get set to 1 after you purchase, used for UI)
- `balance` (balance in cents. gets set to 100 after signup, 2900 after purchase. can never become negative)

Can be removed: `initialized` and other sync columns.

Logic:

- **Free**: up to 2000 posts ($0.30) historic, future posts until balance of $1 depleted (only when used). For free users, put payment URL in every response.
- **Paid $29-109**: up to 100.000 (hardcoded) `posts_historic_count` (keep track of count here) ($15.00), then use the rest for future.
- For now don't allow to retrieve full history YET past 100k posts.
- After first signup, sync starts. After purchase, sync also gets initiated. Sync always gets initiated in background if you do a search and `synced_until` is >24h ago and there is `balance`.

=======

After I have this, it's already something I can use together with parallel tasks. I can build this and make it a real app within a week. I can give this away for free to some friends, and discount price on premium one from $129 to $49 temporarily.

Ensure to have good sad-path when we get INCORRECT CURSOR. cursors may break after a while. What do?

## ✅ Limit large accounts

- Add admin (janwilmake only) testing to sync accounts for free and give them some balance. Should be possible through `/username/sync` and add more balance/maxposts using `/username/admin`
- Do this for some friends and for https://x.com/Scobleizer/status/1975102387758285091
- ❌ Have a limit to how long thread can be (otherwise it can become too expensive for big accounts) **Not needed having sync limit of 2000**
- ✅ Maybe: limit post-count so I can get someones data for under $10. if he's got 10x the posts, 2.5M posts means $375 to scrape. https://x.com/Scobleizer/status/1975102387758285091. How to make it cheaper? It's not needed to have a margin on big accounts like this, but:
  - admin should be able to assign a budget to anyone
  - user should see history is scraped back until YYYY-MM-DD
  - user should be able to keep being synced for months without paying the full amount
  - looking at authorized posts percentage + total posts, we can estimate the total cost, and ask to purchase full history. use big margin.

<!-- Theres hundreds of things more I can add but its vital to get to a STABLE POC that I'm happy to ship. Then next weekend, focus on actually shipping -->
