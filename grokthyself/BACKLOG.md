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

# Refactor to use advanced search

It seems in my manual way that i triggered sync twice. This must not be possible.

Advice from twitterapi.io admin: use advanced search and don't rely on cursor - it's less likely to get me into trouble with broken cursors

# Interaction Analysis

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

# SUPER WISHLIST

## LLMS.txt and context IDE integrations

Based on the interactions analysis we can also create a llms.txt for custom contexts. This can in turn be integrated with tools like https://conare.ai. Another way could be as MCP resources.

## Minibenchmark

simple benchmark: ask questions about your friends people were asking grok a while ago for fun. vibe benchmark grok vs. grokthyself. put on landing.

## Chat Completions

This is literally gold if done well. It should never halucinate and always stay w'in bounds of truth. People must be able to chat with it over my DMs if I don't reply. This is literally epic!

## Viral Feature

After purchasing, you can give 10 invites to friends, who will get $5 for free.

## Chat Completion Thread Simulation

Imagine you could simulate a conversation between 2 (or more) profiles. This is such an underexplored new paradigm!

## Private datapoints

Mainly:

- dms
- likes
- bookmarks

Some can be done at $200/m, while some likely require $5000/m

## OAuth Provider with scopes

Allow {CLIENT_ID} to get access to:

- my network
- my interaction analysis
- entities
- my recent posts & comments

This is huge! Must put checkmarks into oauth provider as well.

## Ship well-converting landingpage

- Free trial
- Then early bird price $29
- Price increases to $59 within a week
- Price finally becomes $129

https://conare.ai

Make shipping plan and actually apply it.
