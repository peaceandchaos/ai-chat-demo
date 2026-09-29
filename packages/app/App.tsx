import React from 'react';
import { StatusBar } from 'react-native';
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { RootDrawer } from './src/screens/RootDrawer';

function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <KeyboardProvider>
        <StatusBar barStyle="light-content" backgroundColor="transparent" />
        <RootDrawer />
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

export default App;
