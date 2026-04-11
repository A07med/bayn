# Bayn

Round 2 Arena — Live Competition Management System

A real-time web application for managing live university competition rounds with parallel matches, timers, and instant results.

## Features

- **Admin Dashboard** — Manage teams, create matches, upload/distribute questions
- **Parallel Matches** — Run 4+ independent matches simultaneously, each with its own timer and questions
- **Real-time Sync** — Supabase Realtime powers live updates across all screens
- **Live Overview** — Big-screen display showing all matches in real-time
- **Results & Leaderboard** — Automatic ranking by completion time
- **Timer with Penalties** — Continuous timer with +10s skip penalties
- **210 Questions** — 7 categories: Math, Chemistry, Biology, Physics, Computer Science, Earth Science, Statistics
- **Sound Effects** — Audio cues for correct/skip actions

## Quick Start

### 1. Prerequisites

- Node.js 18+
- A Supabase project

### 2. Install

```bash
npm install
```

### 3. Set Up Supabase

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Go to **SQL Editor** and run the contents of `supabase-schema.sql`
3. Copy your project URL and anon key from **Settings → API**

### 4. Configure Environment

Create a `.env` file:

```bash
cp .env.example .env
```

Fill in your Supabase credentials:

```
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

### 5. Run

```bash
npm run dev
```

## Usage Guide

### Step 1: Add Teams
Go to Admin Dashboard → Teams tab → Add 8 teams with 3 players each.

### Step 2: Load Questions
Go to Questions tab → Click "Load Sample Questions" to load all 210 questions, or upload your own JSON file.

Question JSON format:
```json
[
  { "question": "ما قيمة sin(90)؟", "answer": "1", "category": "رياضيات" }
]
```

### Step 3: Create Matches
Go to Matches tab → Create 4 matches by selecting Team A and Team B for each.

### Step 4: Distribute Questions
Click "Shuffle & Distribute to Matches". Questions are randomly split across all matches with no repetition.

### Step 5: Run the Competition
Open each match page in a separate browser tab. Controls:
- **START** — Begin the timer
- **Correct** — Advance to next question
- **Skip** — Skip question (+10s penalty)
- **Show Answer** — Reveal the answer

### Step 6: View Results
Navigate to the Results page for completion times and the leaderboard.

## Pages

| Route | Purpose |
|---|---|
| `/` | Admin Dashboard |
| `/match/:id` | Individual match control page |
| `/live` | Live overview of all matches (for big screen) |
| `/results` | Results and leaderboard |

## Question Categories (210 total)

| Category | Count |
|---|---|
| رياضيات (Mathematics) | 30 |
| كيمياء (Chemistry) | 30 |
| أحياء (Biology) | 30 |
| فيزياء (Physics) | 30 |
| علوم حاسب (Computer Science) | 30 |
| علوم أرض وفضاء (Earth Science) | 30 |
| إحصاء (Statistics) | 30 |

## Tech Stack

- **React 19** + Vite
- **Tailwind CSS 4**
- **Supabase** (PostgreSQL + Realtime)
- **React Router 7**
- **Lucide React** (icons)
