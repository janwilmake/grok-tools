# Goal: Get LLM-Friendly Markdown of People You Follow, Synced daily

Data (ensure to use snake_case for columns)

- Stripeflare: https://uithub.com/janwilmake/stripeflare/tree/main/README.md
- `users` (extends stripeflare table structure with username and other details from X/twitter)
- `followings` (has this data from the api, but also uses column `follow_username`)

Client for twitterapi.io that returns valid data format for our database (snake_case):

- https://docs.twitterapi.io/api-reference/endpoint/get_user_followings.md
- https://docs.twitterapi.io/api-reference/endpoint/get_user_by_username.md

Worker:

- stripeflare middleware, cors handling
- `GET /cronjob` to test cronjob
- `GET /{username}[.md|json]` to get markdown or json with all users followings (default markdown). Public if `public:true`, private if `me:true`, otherwise not allowed.
- `GET /followers/{username}` returns number of followers using `getUserByUsername`, cached for a week.
- `GET /me` (provided by stripeflare) returns user authentication data after payment
- daily cronjob that looks up all users with balance >0 and performs the refetch (fully paginated) of all followers of the user, and inserts it into their personal db (not aggregating this one). Ensure this cronjob charges the user and will only perform this job for users with balance >1

Frontend `index.html` (provided as static asset) Shows as a 4-step form:

1. **Username**: Fill in your username to start. Fetches `/followers/{username}`. Show stats nicely when username already provided. Prefil from `?username=` if provided.
2. **Free Your X**. Show in minimal way, with checkmark after freeing, showing whether it's public or me (one of these is required). Use `?redirect_url` back to current url with filled `?username`. Free my X API: https://uithub.com/janwilmake/freemyx/tree/main/README.md
3. **Pay** (Cost: $40 per 1000 follows per year. Recommend deposit amount based on follows count). Button goes to `me.paymentLink`. When balance is >0 it shows as a checkmark, showing balance, and button 'Add more'.
4. **Get data**. button to go to `/{username}.json|md`

Output format:

- Use modern Request -> Response `export default { fetch }` Cloudflare Worker style and Typescript
- https://uithub.com/janwilmake/gists/blob/main/named-codeblocks.md
- Respond with one file `main.ts` in the root
