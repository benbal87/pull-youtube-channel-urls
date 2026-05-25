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

function getHumanReadableDateTime(date = new Date()) {
    return date.toLocaleString('en-GB', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });
}

function createEmptyOutput() {
    return {
        channelId: null,
        updatedAt: null,
        updatedAtHumanReadable: null,
        totalSavedUrls: 0,
        newlySavedUrls: 0,
        urlSets: {},
    };
}

function collectSavedUrls(savedData) {
    return Object.values(savedData.urlSets ?? {})
        .flat()
        .filter((url) => typeof url === 'string');
}

function createUniqueUrlSetKey(urlSets, baseKey) {
    if (!urlSets[baseKey]) {
        return baseKey;
    }

    let counter = 2;
    let key = `${baseKey} (${counter})`;

    while (urlSets[key]) {
        counter += 1;
        key = `${baseKey} (${counter})`;
    }

    return key;
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

async function readExistingData(filePath) {
    try {
        const fileContent = await fs.readFile(filePath, 'utf8');

        if (!fileContent.trim()) {
            return createEmptyOutput();
        }

        const parsed = JSON.parse(fileContent);

        // Backward compatibility for the oldest format:
        // [
        //   "https://www.youtube.com/watch?v=..."
        // ]
        if (Array.isArray(parsed)) {
            return {
                ...createEmptyOutput(),
                urlSets: {
                    'legacy import': parsed,
                },
            };
        }

        // Current preferred format:
        // {
        //   "urlSets": {
        //     "25/05/2026, 21:15:30": [...]
        //   }
        // }
        if (parsed.urlSets && typeof parsed.urlSets === 'object' && !Array.isArray(parsed.urlSets)) {
            return {
                ...createEmptyOutput(),
                ...parsed,
                urlSets: parsed.urlSets,
            };
        }

        // Backward compatibility for your previous format:
        // {
        //   "urls": [...]
        // }
        if (Array.isArray(parsed.urls)) {
            return {
                ...createEmptyOutput(),
                ...parsed,
                urlSets: {
                    'legacy import': parsed.urls,
                },
            };
        }

        throw new Error(`Invalid JSON format in ${filePath}`);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return createEmptyOutput();
        }

        throw error;
    }
}

async function saveOnlyNewUrls(channelInput, outputFile = DEFAULT_OUTPUT_FILE) {
    const {channelId, urls: fetchedUrls} = await getAllUploadedVideoUrls(channelInput);

    const existingData = await readExistingData(outputFile);
    const existingUrls = collectSavedUrls(existingData);
    const existingUrlSet = new Set(existingUrls);

    const newUrls = fetchedUrls.filter((url) => !existingUrlSet.has(url));

    const now = new Date();
    const humanReadableDateTime = getHumanReadableDateTime(now);

    const urlSets = {
        ...(existingData.urlSets ?? {}),
    };

    let newUrlSetKey = null;

    if (newUrls.length > 0) {
        newUrlSetKey = createUniqueUrlSetKey(urlSets, humanReadableDateTime);
        urlSets[newUrlSetKey] = newUrls;
    }

    const totalSavedUrls = collectSavedUrls({urlSets}).length;

    const output = {
        channelId,
        updatedAt: now.toISOString(),
        updatedAtHumanReadable: humanReadableDateTime,
        totalSavedUrls,
        newlySavedUrls: newUrls.length,
        urlSets,
    };

    await fs.writeFile(outputFile, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

    return {
        outputFile,
        totalFetchedUrls: fetchedUrls.length,
        totalSavedUrls,
        newlySavedUrls: newUrls.length,
        newUrlSetKey,
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
    .then((result) => {
        console.log(`Fetched URLs: ${result.totalFetchedUrls}`);
        console.log(`Already saved + new URLs: ${result.totalSavedUrls}`);
        console.log(`Newly saved URLs: ${result.newlySavedUrls}`);
        console.log(`Output file: ${result.outputFile}`);

        if (result.newUrls.length > 0) {
            console.log(`\nNew URL set: ${result.newUrlSetKey}`);
            console.log('New URLs:');

            for (const url of result.newUrls) {
                console.log(url);
            }
        } else {
            console.log('\nNo new URLs found.');
        }
    })
    .catch((error) => {
        console.error(error.message);
        process.exit(1);
    });