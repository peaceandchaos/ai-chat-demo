import React, { useEffect, useState } from 'react';
import { StatusBar } from 'react-native';
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
    void startAppSession().then(() => setReady(true));
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
