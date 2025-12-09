import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { AuthProvider } from './src/context/AuthContext';
import { ThemeProvider } from './src/context/ThemeContext';
import { OfflineProvider } from './src/context/OfflineContext';
import SyncStatusBar from './src/components/SyncStatusBar';
import RootNavigator from './src/navigation/RootNavigator';

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <OfflineProvider>
          <View style={styles.container}>
            <SyncStatusBar />
            <NavigationContainer>
              <StatusBar style="light" />
              <RootNavigator />
            </NavigationContainer>
          </View>
        </OfflineProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
