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

# TODO

## better landingpage

- install myself as mcp, improve flow if there's problems
- work on good examples by using it

## simplify installation

- add `/login` in front in oauth flow
- on frontpage, ask to

## Interaction Analysis

<!--
See https://letmeprompt.com/httpsmarkdownfeed-xcibrc0

Doing weekly LLM-based named entity recognition on the last tokens in your timeline can be **incredibly powerful**! Imagine you could scope this for any person as a one-time scope or continuous scope, as long as they give access... This definitely is a product in itself that can make money. Should charge X price for its information...

It's perfect to then combine this with the task API: you login with X, then have a bunch of named entities as starting inputs for your APIs.

All in all, this could just be a tiny service:

- login with markdownfeed that has X money
- purchase feed for n weeks, and with that, accept terms (uses markdownfeed api)
- use api for letmeprompt + markdownfeed. generated result will become available as codeblock in a completion result at a fixed url
- provide this as oauth provider

Now, I can make the following for parallel

- Login with X
- Do one-time named entity recognition
- Any examples in the playground use these named entities
-->

What's the most valuable? I guess a full context over my top N people is super valuable!!!!! Imagine a chat with janwilmake that knows his top 50 interactions very well, allowing it to use tool of another person context! Also, entities are super important for further deepening context. This is what will make it really stand out.

Core feature:

- After initial sync is complete, for your top 150, do one LLM query per interaction, extracting `{ x_usernames:{[key:string]:string}, companies:{[key:string]:string}, websites:{[key:string]:string}, search_keywords:string[], interaction_summary:string,...}` and store `ai_analysis_interaction_count`.
- Redo it every week for accounts where more than 10 new interactions took place.
- Charge for LLM cost.
- Create `interactions_analysis:{summary:string,beliefs,principles,values}` which does an LLM prompt max once a month over all your interactions
- Add `interactions` JSON[] and `interactions_summary` into `users` as new columns
- Add interaction analysis into stats page
- Add structured data for this
- Add this as main MCP system prompt
- Update MCP such that `?username` is `.well-known/mcp-config` (optional, defaults to logged in user)
- Create aggregate DO with just the users table (also has interactions)
