# 🎬 Flick Pick

A daily movie guessing game. Each day, all players see the same movie still — guess the title, director, actors, and screenwriter to score points.

## Tech Stack

- **Frontend**: Next.js (App Router) + TypeScript + Tailwind CSS
- **Database**: PostgreSQL on AWS RDS (Prisma ORM)
- **Auth**: AWS Cognito (JWT)
- **Hosting**: AWS Amplify
- **Movie Data**: TMDb API
- **Background Jobs**: AWS Lambda + EventBridge

## Getting Started

1. Clone the repo
2. Copy `.env.example` to `.env` and fill in your values
3. `npm install`
4. `npx prisma generate`
5. `npx prisma db push` (for development)
6. `npm run dev`

## Environment Variables

See `.env.example` for required variables.

## Attribution

This product uses the [TMDb API](https://www.themoviedb.org/) but is not endorsed or certified by TMDb.
