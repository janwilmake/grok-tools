# Sync Your Followings

This is a [Stripeflare](https://github.com/janwilmake/stripeflare) Project for `xysql-followings`. This project is configured for: https://followings.xysql.com

## Setup

1. Install dependencies: `npm install`
2. Configure your environment variables in `.dev.vars`
3. Deploy: `wrangler deploy`

## Development

- `wrangler dev` - Start local development server

## Payment link configuration

It is not possible to edit payment links config through the Stripe Dashboard after creating the payment link programmatically, so if you want to change it, replace `env.STRIPE_PAYMENT_LINK` with a payment link you create yourself.
