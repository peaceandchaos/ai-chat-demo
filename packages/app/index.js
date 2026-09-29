/**
 * @format
 */

import { AppRegistry } from 'react-native';
import { prewarmOnAppStart } from 'react-native-nitro-websockets';
import App from './App';
import { name as appName } from './app.json';
import { OPENAI_API_KEY, OPENAI_WS_URL } from './src/config';

// Open the OpenAI websocket natively at app start, before the JS bundle loads,
// so the connection is already warm by the time the first message is sent.
prewarmOnAppStart(OPENAI_WS_URL, undefined, {
  Authorization: `Bearer ${OPENAI_API_KEY}`,
});

AppRegistry.registerComponent(appName, () => App);
