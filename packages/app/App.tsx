import React, { useEffect, useState } from 'react';
import { Alert, StatusBar } from 'react-native';
import BootSplash from 'react-native-bootsplash';
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { RootDrawer } from './src/screens/RootDrawer';
import { startAppSession } from './src/state/appSession';

function App() {
  // The splash stays up until ChatScreen draws, so waiting here shows nothing new.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const start = (): void => {
      startAppSession().then(
        () => setReady(true),
        () => {
          void BootSplash.hide({ fade: true });
          Alert.alert(
            'Something went wrong',
            'Your chats could not be opened.',
            [{ text: 'Retry', onPress: start }],
          );
        },
      );
    };
    start();
  }, []);

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <KeyboardProvider>
        <StatusBar barStyle="light-content" backgroundColor="transparent" />
        {ready ? <RootDrawer /> : null}
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

export default App;
