import 'dotenv/config';
import {google} from 'googleapis';
import fs from 'node:fs/promises';

const youtube = google.youtube({
    version: 'v3',
    auth: process.env.YOUTUBE_API_KEY,
});

const DEFAULT_OUTPUT_FILE = 'youtube-video-urls.json';

function parseChannelInput(input) {
    const value = input.trim();

    if (/^UC[a-zA-Z0-9_-]{20,}$/.test(value)) {
        return {id: value};
    }

    const channelIdMatch = value.match(/youtube\.com\/channel\/([^/?#]+)/);
    if (channelIdMatch) {
        return {id: channelIdMatch[1]};
    }

    if (value.startsWith('@')) {
        return {forHandle: value};
    }

    const handleMatch = value.match(/youtube\.com\/@([^/?#]+)/);
    if (handleMatch) {
        return {forHandle: `@${handleMatch[1]}`};
    }

    const usernameMatch = value.match(/youtube\.com\/user\/([^/?#]+)/);
    if (usernameMatch) {
        return {forUsername: usernameMatch[1]};
    }

    return {forHandle: value.startsWith('@') ? value : `@${value}`};
}

async function getUploadsPlaylistId(channelInput) {
    const lookup = parseChannelInput(channelInput);

    const response = await youtube.channels.list({
        part: ['contentDetails'],
        ...lookup,
    });

    const channel = response.data.items?.[0];

    if (!channel) {
        throw new Error(`No channel found for input: ${channelInput}`);
    }

    return {
        channelId: channel.id,
        uploadsPlaylistId: channel.contentDetails.relatedPlaylists.uploads,
    };
}

async function getAllUploadedVideoUrls(channelInput) {
    const {channelId, uploadsPlaylistId} = await getUploadsPlaylistId(channelInput);

    const urls = [];
    let pageToken = undefined;

    do {
        const response = await youtube.playlistItems.list({
            part: ['contentDetails'],
            playlistId: uploadsPlaylistId,
            maxResults: 50,
            pageToken,
        });

        for (const item of response.data.items ?? []) {
            const videoId = item.contentDetails?.videoId;

            if (!videoId) continue;

            urls.push(`https://www.youtube.com/watch?v=${videoId}`);
        }

        pageToken = response.data.nextPageToken;
    } while (pageToken);

    return {
        channelId,
        urls,
    };
}

async function readExistingUrls(filePath) {
    try {
        const fileContent = await fs.readFile(filePath, 'utf8');

        if (!fileContent.trim()) {
            return [];
        }

        const parsed = JSON.parse(fileContent);

        if (Array.isArray(parsed)) {
            return parsed;
        }

        if (Array.isArray(parsed.urls)) {
            return parsed.urls;
        }

        throw new Error(`Invalid JSON format in ${filePath}`);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return [];
        }

        throw error;
    }
}

async function saveOnlyNewUrls(channelInput, outputFile = DEFAULT_OUTPUT_FILE) {
    const {channelId, urls: fetchedUrls} = await getAllUploadedVideoUrls(channelInput);

    const existingUrls = await readExistingUrls(outputFile);
    const existingUrlSet = new Set(existingUrls);

    const newUrls = fetchedUrls.filter((url) => !existingUrlSet.has(url));

    const mergedUrls = [...existingUrls, ...newUrls];

    const output = {
        channelId,
        updatedAt: new Date().toISOString(),
        totalSavedUrls: mergedUrls.length,
        newlySavedUrls: newUrls.length,
        urls: mergedUrls,
    };

    await fs.writeFile(outputFile, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

    return {
        outputFile,
        totalFetchedUrls: fetchedUrls.length,
        totalSavedUrls: mergedUrls.length,
        newlySavedUrls: newUrls.length,
        newUrls,
    };
}

// CLI usage:
// node youtube-videos.js @GoogleDevelopers
// node youtube-videos.js @GoogleDevelopers my-output-file.json

const channelInput = process.argv[2];
const outputFile = process.argv[3] ?? DEFAULT_OUTPUT_FILE;

if (!channelInput) {
    console.error('Usage: node youtube-videos.js <channel-id-or-url-or-handle> [output-file]');
    process.exit(1);
}

saveOnlyNewUrls(channelInput, outputFile)
    .then(async (result) => {
        console.log(`Fetched URLs: ${result.totalFetchedUrls}`);
        console.log(`Already saved + new URLs: ${result.totalSavedUrls}`);
        console.log(`Newly saved URLs: ${result.newlySavedUrls}`);
        console.log(`Output file: ${result.outputFile}`);

        if (result.newUrls.length > 0) {
            console.log('\nNew URLs:');
            for (const url of result.newUrls) {
                console.log(url);
            }
        }
    })
    .catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
