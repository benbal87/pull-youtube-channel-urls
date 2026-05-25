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
        updatedAt: null,
        updatedAtHumanReadable: null,
        totalSavedUrls: 0,
        newlySavedUrls: 0,
        channels: {},
    };
}

function createEmptyChannelOutput(channelId = null, channelInput = null, channelTitle = null) {
    return {
        channelId,
        channelTitle,
        channelInputs: channelInput ? [channelInput] : [],
        updatedAt: null,
        updatedAtHumanReadable: null,
        totalSavedUrls: 0,
        newlySavedUrls: 0,
        urlSets: {},
    };
}

function collectSavedUrls(channelData) {
    return Object.values(channelData.urlSets ?? {})
        .flat()
        .filter((url) => typeof url === 'string');
}

function collectAllSavedUrls(savedData) {
    return Object.values(savedData.channels ?? {})
        .flatMap((channelData) => collectSavedUrls(channelData));
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

function addUniqueValue(values, value) {
    if (!value) {
        return values ?? [];
    }

    return Array.from(new Set([...(values ?? []), value]));
}

async function getUploadsPlaylistId(channelInput) {
    const lookup = parseChannelInput(channelInput);

    const response = await youtube.channels.list({
        part: ['contentDetails', 'snippet'],
        ...lookup,
    });

    const channel = response.data.items?.[0];

    if (!channel) {
        throw new Error(`No channel found for input: ${channelInput}`);
    }

    return {
        channelId: channel.id,
        channelTitle: channel.snippet?.title ?? null,
        uploadsPlaylistId: channel.contentDetails.relatedPlaylists.uploads,
    };
}

async function getAllUploadedVideoUrls(channelInput) {
    const {channelId, channelTitle, uploadsPlaylistId} = await getUploadsPlaylistId(channelInput);

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
        channelTitle,
        urls,
    };
}

function normalizeExistingData(parsed) {
    // New multi-channel format:
    // {
    //   "channels": {
    //     "UC...": {
    //       "urlSets": {
    //         "25/05/2026, 21:15:30": [...]
    //       }
    //     }
    //   }
    // }
    if (parsed.channels && typeof parsed.channels === 'object' && !Array.isArray(parsed.channels)) {
        const output = {
            ...createEmptyOutput(),
            ...parsed,
            channels: parsed.channels,
        };

        output.totalSavedUrls = collectAllSavedUrls(output).length;

        return output;
    }

    // Backward compatibility for oldest format:
    // [
    //   "https://www.youtube.com/watch?v=..."
    // ]
    if (Array.isArray(parsed)) {
        const legacyChannelId = 'legacy-channel';

        const output = createEmptyOutput();

        output.channels[legacyChannelId] = {
            ...createEmptyChannelOutput(legacyChannelId),
            channelTitle: 'Legacy imported channel',
            urlSets: {
                'legacy import': parsed,
            },
            totalSavedUrls: parsed.length,
        };

        output.totalSavedUrls = parsed.length;

        return output;
    }

    // Backward compatibility for previous single-channel urlSets format:
    // {
    //   "channelId": "UC...",
    //   "urlSets": {
    //     "25/05/2026, 21:15:30": [...]
    //   }
    // }
    if (parsed.urlSets && typeof parsed.urlSets === 'object' && !Array.isArray(parsed.urlSets)) {
        const channelId = parsed.channelId ?? 'legacy-channel';

        const channelData = {
            ...createEmptyChannelOutput(channelId),
            ...parsed,
            channelId,
            urlSets: parsed.urlSets,
        };

        channelData.totalSavedUrls = collectSavedUrls(channelData).length;

        const output = createEmptyOutput();

        output.channels[channelId] = channelData;
        output.totalSavedUrls = collectAllSavedUrls(output).length;

        return output;
    }

    // Backward compatibility for previous format:
    // {
    //   "urls": [...]
    // }
    if (Array.isArray(parsed.urls)) {
        const channelId = parsed.channelId ?? 'legacy-channel';

        const output = createEmptyOutput();

        output.channels[channelId] = {
            ...createEmptyChannelOutput(channelId),
            ...parsed,
            channelId,
            urlSets: {
                'legacy import': parsed.urls,
            },
            totalSavedUrls: parsed.urls.length,
        };

        output.totalSavedUrls = parsed.urls.length;

        return output;
    }

    throw new Error('Invalid JSON format');
}

async function readExistingData(filePath) {
    try {
        const fileContent = await fs.readFile(filePath, 'utf8');

        if (!fileContent.trim()) {
            return createEmptyOutput();
        }

        const parsed = JSON.parse(fileContent);

        return normalizeExistingData(parsed);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return createEmptyOutput();
        }

        throw error;
    }
}

async function saveOnlyNewUrls(channelInputs, outputFile = DEFAULT_OUTPUT_FILE) {
    const existingData = await readExistingData(outputFile);

    const now = new Date();
    const humanReadableDateTime = getHumanReadableDateTime(now);

    const results = [];
    let totalFetchedUrls = 0;
    let totalNewlySavedUrls = 0;

    const output = {
        ...existingData,
        channels: {
            ...(existingData.channels ?? {}),
        },
    };

    for (const channelInput of channelInputs) {
        const {
            channelId,
            channelTitle,
            urls: fetchedUrls,
        } = await getAllUploadedVideoUrls(channelInput);

        totalFetchedUrls += fetchedUrls.length;

        const existingChannelData =
            output.channels[channelId] ??
            createEmptyChannelOutput(channelId, channelInput, channelTitle);

        const existingUrls = collectSavedUrls(existingChannelData);
        const existingUrlSet = new Set(existingUrls);

        const newUrls = fetchedUrls.filter((url) => !existingUrlSet.has(url));

        const urlSets = {
            ...(existingChannelData.urlSets ?? {}),
        };

        let newUrlSetKey = null;

        if (newUrls.length > 0) {
            newUrlSetKey = createUniqueUrlSetKey(urlSets, humanReadableDateTime);
            urlSets[newUrlSetKey] = newUrls;
        }

        const totalSavedUrlsForChannel = collectSavedUrls({urlSets}).length;

        output.channels[channelId] = {
            ...existingChannelData,
            channelId,
            channelTitle: channelTitle ?? existingChannelData.channelTitle ?? null,
            channelInputs: addUniqueValue(existingChannelData.channelInputs, channelInput),
            updatedAt: now.toISOString(),
            updatedAtHumanReadable: humanReadableDateTime,
            totalSavedUrls: totalSavedUrlsForChannel,
            newlySavedUrls: newUrls.length,
            urlSets,
        };

        totalNewlySavedUrls += newUrls.length;

        results.push({
            channelInput,
            channelId,
            channelTitle,
            totalFetchedUrls: fetchedUrls.length,
            totalSavedUrls: totalSavedUrlsForChannel,
            newlySavedUrls: newUrls.length,
            newUrlSetKey,
            newUrls,
        });
    }

    output.updatedAt = now.toISOString();
    output.updatedAtHumanReadable = humanReadableDateTime;
    output.totalSavedUrls = collectAllSavedUrls(output).length;
    output.newlySavedUrls = totalNewlySavedUrls;

    await fs.writeFile(outputFile, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

    return {
        outputFile,
        totalFetchedUrls,
        totalSavedUrls: output.totalSavedUrls,
        newlySavedUrls: totalNewlySavedUrls,
        channels: results,
    };
}

// CLI usage:
// node youtube-videos.js @GoogleDevelopers @freecodecamp @Fireship
// node youtube-videos.js https://www.youtube.com/@GoogleDevelopers https://www.youtube.com/@freecodecamp

const channelInputs = process.argv.slice(2);

if (channelInputs.length === 0) {
    console.error('Usage: node youtube-videos.js <channel-id-or-url-or-handle> [...more-channels]');
    process.exit(1);
}

saveOnlyNewUrls(channelInputs)
    .then((result) => {
        console.log(`Fetched URLs: ${result.totalFetchedUrls}`);
        console.log(`Already saved + new URLs across all channels: ${result.totalSavedUrls}`);
        console.log(`Newly saved URLs across all channels: ${result.newlySavedUrls}`);
        console.log(`Output file: ${result.outputFile}`);

        for (const channelResult of result.channels) {
            console.log('\n----------------------------------------');
            console.log(`Channel input: ${channelResult.channelInput}`);
            console.log(`Channel title: ${channelResult.channelTitle ?? 'Unknown'}`);
            console.log(`Channel ID: ${channelResult.channelId}`);
            console.log(`Fetched URLs: ${channelResult.totalFetchedUrls}`);
            console.log(`Already saved + new URLs for this channel: ${channelResult.totalSavedUrls}`);
            console.log(`Newly saved URLs for this channel: ${channelResult.newlySavedUrls}`);

            if (channelResult.newUrls.length > 0) {
                console.log(`New URL set: ${channelResult.newUrlSetKey}`);
                console.log('New URLs:');

                for (const url of channelResult.newUrls) {
                    console.log(url);
                }
            } else {
                console.log('No new URLs found for this channel.');
            }
        }
    })
    .catch((error) => {
        console.error(error.message);
        process.exit(1);
    });