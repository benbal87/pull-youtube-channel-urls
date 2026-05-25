# YouTube Video URL Collector

A small Node.js script that fetches all uploaded video URLs from one or more YouTube channels and saves only newly discovered URLs into a single JSON file.

The saved data is separated by YouTube channel, and every new batch of URLs is stored under a human-readable date/time key.

## Features

- Accepts multiple YouTube channel inputs in one command.
- Supports channel IDs, channel URLs, handles, handle URLs, and legacy username URLs.
- Saves all data into one JSON file: `youtube-video-urls.json`.
- Separates saved URLs by YouTube channel.
- Saves only newly discovered video URLs.
- Groups every newly discovered URL batch by the current human-readable date/time.
- Preserves previously saved data.
- Includes backward compatibility for older JSON formats used by previous versions of the script.

## Requirements

- Node.js 18 or newer recommended
- A YouTube Data API v3 key
- npm dependencies:
  - `googleapis`
  - `dotenv`

## Installation

Create a new project folder, then install the required packages:

```bash
npm init -y
npm install googleapis dotenv
```

Because the script uses ES module imports, add this to your `package.json`:

```json
{
  "type": "module"
}
```

## Environment Variables

Create a `.env` file in the same folder as the script:

```env
YOUTUBE_API_KEY=your_google_youtube_api_key_here
```

The script reads this key using `dotenv/config`.

## Script Name

The examples below assume the script is saved as:

```text
youtube-videos.js
```

You can use a different filename, but then you must adjust the commands accordingly.

## Usage

Run the script with one or more YouTube channel inputs:

```bash
node youtube-videos.js <channel-id-or-url-or-handle> [...more-channels]
```

Examples:

```bash
node youtube-videos.js @GoogleDevelopers
```

```bash
node youtube-videos.js @GoogleDevelopers @freecodecamp @Fireship
```

```bash
node youtube-videos.js https://www.youtube.com/@GoogleDevelopers https://www.youtube.com/@freecodecamp
```

```bash
node youtube-videos.js UC_x5XG1OV2P6uZZ5FSM9Ttw
```

## Supported Channel Input Formats

The script supports the following input formats:

```text
@GoogleDevelopers
GoogleDevelopers
https://www.youtube.com/@GoogleDevelopers
https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw
UC_x5XG1OV2P6uZZ5FSM9Ttw
https://www.youtube.com/user/SomeLegacyUsername
```

## Output File

The script always writes to:

```text
youtube-video-urls.json
```

The output file path is currently controlled by this constant in the script:

```js
const DEFAULT_OUTPUT_FILE = 'youtube-video-urls.json';
```

The output file is not passed as a CLI argument.

## Output JSON Structure

The saved JSON has this general structure:

```json
{
  "updatedAt": "2026-05-25T19:30:00.000Z",
  "updatedAtHumanReadable": "25/05/2026, 21:30:00",
  "totalSavedUrls": 1234,
  "newlySavedUrls": 12,
  "channels": {
    "UC_x5XG1OV2P6uZZ5FSM9Ttw": {
      "channelId": "UC_x5XG1OV2P6uZZ5FSM9Ttw",
      "channelTitle": "Google for Developers",
      "channelInputs": [
        "@GoogleDevelopers"
      ],
      "updatedAt": "2026-05-25T19:30:00.000Z",
      "updatedAtHumanReadable": "25/05/2026, 21:30:00",
      "totalSavedUrls": 500,
      "newlySavedUrls": 3,
      "urlSets": {
        "25/05/2026, 21:30:00": [
          "https://www.youtube.com/watch?v=..."
        ]
      }
    }
  }
}
```

## How URL Saving Works

For each channel, the script:

1. Resolves the channel input to a YouTube channel.
2. Finds the channel's uploads playlist.
3. Fetches every video from that uploads playlist.
4. Compares the fetched URLs with the URLs already saved for that channel.
5. Saves only URLs that were not already present.
6. Stores the new URLs under the current human-readable date/time key.

If no new URLs are found for a channel, the script keeps the previous data and prints:

```text
No new URLs found for this channel.
```

## Multiple Runs

You can run the script repeatedly.

Example:

```bash
node youtube-videos.js @GoogleDevelopers @freecodecamp
```

On the first run, the script may save many URLs.

On later runs, it will only save newly uploaded videos that were not already present in `youtube-video-urls.json`.

## Duplicate Date/Time Keys

If the same date/time key already exists in a channel's `urlSets`, the script creates a unique key by appending a counter:

```text
25/05/2026, 21:30:00
25/05/2026, 21:30:00 (2)
25/05/2026, 21:30:00 (3)
```

## Console Output

After running, the script prints a summary like this:

```text
Fetched URLs: 1200
Already saved + new URLs across all channels: 1234
Newly saved URLs across all channels: 12
Output file: youtube-video-urls.json
```

Then it prints a separate summary for each channel.

## Backward Compatibility

The script can read and migrate older output formats, including:

Old array format:

```json
[
  "https://www.youtube.com/watch?v=..."
]
```

Previous single-channel format:

```json
{
  "urlSets": {
    "25/05/2026, 21:15:30": [
      "https://www.youtube.com/watch?v=..."
    ]
  }
}
```

Previous URL array format:

```json
{
  "urls": [
    "https://www.youtube.com/watch?v=..."
  ]
}
```

When older data is detected, it is converted into the newer `channels`-based structure.

## Common Errors

### `No channel found for input`

The script could not resolve the provided channel input.

Check that the input is a valid YouTube channel ID, handle, or channel URL.

### `The request cannot be completed because you have exceeded your quota`

The YouTube Data API has a daily quota limit.

Try again later, reduce the number of channels, or check your Google Cloud quota settings.

### `YOUTUBE_API_KEY` is missing or invalid

Make sure your `.env` file exists and contains:

```env
YOUTUBE_API_KEY=your_google_youtube_api_key_here
```

Also make sure the YouTube Data API v3 is enabled for the Google Cloud project that owns the API key.

## Notes

This script only collects public YouTube video URLs from channel upload playlists.

It does not download videos or audio.

It uses the official YouTube Data API v3 through the `googleapis` npm package.
