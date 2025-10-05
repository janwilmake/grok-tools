## X Y SQL - Sync Your X Data into a AI-Driven SQL Database

CONTEXT:

- https://uithub.com/janwilmake/gists/blob/main/named-codeblocks.md
- Stripeflare template: https://uuithub.com/janwilmake/stripeflare/tree/main?pathPatterns=template.ts&pathPatterns=template.html&pathPatterns=openapi.json
- server: https://api.socialdata.tools
- `/twitter/user/{username}`: https://lmpify.com/httpsdocssociald-xu3kd20.md?key=result
- `/twitter/user/{user_id}/tweets`: https://lmpify.com/give-me-the-subset-o-2z81t30.md?key=result

SPEC:

**fetch**

- user has `{ historic_tweets_cursor, max_historic_tweets, earliest_tweet_id, earliest_tweet_at, recent_tweet_id, recent_tweet_at }` and the regular stuff from stripeflare
- posts table has all columns posts have with logical indexes
- use `client_reference_id` as db-name
- `GET /access_token` should return the access_token
- `POST /config`: endpoint to update `max_historic_tweets` (default is 1000)
- `POST /set-username`: it needs to be possible to set your x username, after which it queries the user details and fills that into the user table. After setting you cannot change it anymore
- User needs to be charged for SQL api usage: 0.01 cent per request to `/api/{client_reference_id}/*`

**`index.html`**

- Headline: X Y SQL - Sync your X, Query with SQL
- Don't use the word Twitter, use 'X'.
- takes data from `window.data`
- shows `balance`, `email`, `max_historic_tweets`
- a button navigating to payment link
- a form to edit `max_historic_tweets`
- a form to set username
- If balance is undefined, just show payment button.
- Instruct easily connecting to `/db/{client_reference_id}` with secret `access_token` at https://studio.outerbase.com

**schedule**

- keep all users up-to-date using minutely cronjob for people active in the last hour, hourly cronjob for people active in the last day, and daily cronjob for all others, adding an updater-job to the queue
- paginate over `getTwitterUserTweets` until `recent_tweet_id` is found. ensure to use `limit 1` at the start to reduce waste
- if we don't have `max_historic_tweets` tweets yet, paginate over `getTwitterUserTweets` from `earliest_tweet_id` until we have `max_historic_tweets`.
- ensure to use `limit 1` at the start to reduce waste
- user needs to be charged $2 per 1000 posts.

Make this cloudflare worker in typescript. the index.html should be a separate file, injecting the window.data through string.replace

NB: the query result will be from client db of `name`

TODO: just pin sql stuff and env, improve spec, then rewrite whole stuff from spec directly.
