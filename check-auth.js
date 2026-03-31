
import 'dotenv/config';
import { google } from 'googleapis';

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

console.log('Checking credentials...');
console.log('Client ID:', clientId ? 'Found' : 'MISSING');
console.log('Client Secret:', clientSecret ? 'Found' : 'MISSING');
console.log('Refresh Token:', refreshToken ? 'Found' : 'MISSING');

if (!clientId || !clientSecret || !refreshToken) {
    process.exit(1);
}

const auth = new google.auth.OAuth2(clientId, clientSecret);
auth.setCredentials({ refresh_token: refreshToken });

async function check() {
    try {
        const { credentials } = await auth.refreshAccessToken();
        console.log('Token refreshed successfully!');
        console.log('New Access Token:', credentials.access_token ? 'Received' : 'NONE');
    } catch (err) {
        console.error('Error refreshing token:', err.message);
        if (err.message.includes('invalid_grant')) {
            console.error('CONFIRMED: The refresh token is invalid, expired, or revoked.');
        }
    }
}

check();
