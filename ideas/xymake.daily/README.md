cloudflare typescript worker that has a daily schedule and a queue

the daily schedule fetches https://xymake.com/users.json, then puts each user in the queue

the queue handles fetching https://xymake.com/{username}/with_replies.json. the result is something like {url:string}[], all urls need to be fetched and the responses aggregated in a object as

{ [url:string]: string }

that can then be stored in env.TWEET_KV.put(`${username}-daily`)

<!-- please make me the main.ts and wrangler.toml -->
