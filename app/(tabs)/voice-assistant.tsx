import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  AudioModule,
  RecordingPresets,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import * as Speech from 'expo-speech';
import React, { useEffect, useState } from 'react';
import { Alert, Button, ScrollView, StyleSheet } from 'react-native';

const WORKER_URL = 'https://broken-leaf-2ab3.azaininijar.workers.dev';

export default function VoiceAssistantScreen() {
  // Permission state
  const [permissionGranted, setPermissionGranted] = useState(false);

  // Recorder and its state
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  // Player and its playback status
  const player = useAudioPlayer(null);
  const playerStatus = useAudioPlayerStatus(player);

  const [status, setStatus] = useState<'idle' | 'recording' | 'processing'>('idle');
  const [conversation, setConversation] = useState<{ user: string; bot: string }[]>([]);

  // Request microphone permission on mount
  useEffect(() => {
    (async () => {
      const { granted } = await AudioModule.requestRecordingPermissionsAsync();
      setPermissionGranted(granted);
    })();

    // Cleanup player on unmount
    return () => {
      player.remove();
    };
  }, []);

  // Speech to Text function
  
async function speechToText(audioUri: string): Promise<string> {
  try {
    const file = new File(audioUri);

    const base64data = await file.base64()

    console.log("AUDIO URI ====> ", audioUri);

    const response = await fetch(`${WORKER_URL}/stt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: base64data }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`STT failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    console.log("STT RESPONSE JSON", result);

    if (!result.success || !result.transcript) {
      throw new Error('Invalid STT response');
    }

    return result.transcript;
  } catch (error) {
    console.error('Speech-to-text failed:', error);
    throw error;
  }
}

  // Send message to AI
  async function sendToAI(text: string): Promise<string> {
    try {
      const response = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversationHistory: conversation
            .map((c) => [
              { role: 'user', content: c.user },
              { role: 'assistant', content: c.bot },
            ])
            .flat(),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AI failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      if (data.success && data.response) return data.response;

      throw new Error(data.error || 'Failed to get AI response');
    } catch (error) {
      console.error('AI error:', error);
      throw error;
    }
  }


useEffect(() => {
  if (playerStatus.isLoaded && playerStatus.didJustFinish) {
    player.pause();
    player.remove();
  }
}, [status]);

  // Play AI speech from TTS endpoint
  
async function playAISpeech(text: string) {
  try {
    const response = await fetch(`${WORKER_URL}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) throw new Error(`TTS failed: ${response.status}`);

    const blob = await response.blob();
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    await new Promise((resolve) => { reader.onloadend = resolve; });

    const base64data = (reader.result as string).split(',')[1];
    // Untuk simpan file, gunakan cacheDirectory dari FileSystem
    const fileSource = { uri: `data:audio/mp3;base64,${base64data}`, isStatic: true };

    // Ganti audio source player menggunakan replace
    await player.pause();
    player.remove();
    await player.replace({ uri: fileSource.uri });
    await player.play();

  } catch (error) {
    console.error('AI TTS error:', error);
    Alert.alert('TTS Error', 'Using fallback voice.');
    Speech.speak(text, { language: 'id-ID' });
  }
}

  // Start recording handler
  async function handleStartRecording() {
    if (!permissionGranted) {
      Alert.alert('Permission Required', 'Please grant microphone permission.');
      return;
    }
    setStatus('recording');
    await recorder.prepareToRecordAsync();
    recorder.record();
  }

  // Stop recording handler
  async function handleStopRecording() {
    if (!recorderState.isRecording) return;

    setStatus('processing');
    await recorder.stop();

    const uri = recorder.uri;

    if (!uri) {
      Alert.alert('Error', 'No recorded audio URI found.');
      setStatus('idle');
      return;
    }

    setConversation((prev) => [...prev, { user: '...', bot: '...' }]);
    try {
      const userMessage = await speechToText(uri);

      setConversation((prev) => {
        const newConv = [...prev];
        newConv[newConv.length - 1] = { user: userMessage, bot: '...' };
        return newConv;
      });

      const botResponse = await sendToAI(userMessage);

      setConversation((prev) => {
        const newConv = [...prev];
        newConv[newConv.length - 1] = { user: userMessage, bot: botResponse };
        return newConv;
      });

      await playAISpeech(botResponse);
    } catch (error) {
      console.error('Error in voice assistant flow:', error);
      setConversation((prev) => prev.filter((c) => c.user !== '...'));
    } finally {
      setStatus('idle');
    }
  }

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title" style={styles.title}>
        🎤 Voice Assistant
      </ThemedText>

      <ThemedView style={styles.buttonContainer}>
        <Button
          title={status === 'recording' ? '⏹️ Stop Recording' : '🎙️ Start Recording'}
          onPress={status === 'recording' ? handleStopRecording : handleStartRecording}
          disabled={status === 'processing'}
          color={status === 'recording' ? '#ff4444' : '#4CAF50'}
        />
      </ThemedView>

      <ThemedView style={styles.statusContainer}>
        <ThemedText style={styles.status}>
          Status:{' '}
          {status === 'idle'
            ? '⚪ Ready'
            : status === 'recording'
            ? '🔴 Recording...'
            : '⏳ Processing...'}
        </ThemedText>
      </ThemedView>

      <ScrollView style={styles.conversationContainer} contentContainerStyle={styles.conversationContent}>
        {conversation.length === 0 ? (
          <ThemedText style={styles.emptyState}>Tap the button above to start a conversation</ThemedText>
        ) : (
          conversation.map((entry, index) => (
            <ThemedView key={index} style={styles.messageContainer}>
              <ThemedView style={styles.userMessage}>
                <ThemedText type="defaultSemiBold" style={styles.messageLabel}>
                  You:
                </ThemedText>
                <ThemedText style={styles.messageText}>{entry.user}</ThemedText>
              </ThemedView>

              <ThemedView style={styles.botMessage}>
                <ThemedText type="defaultSemiBold" style={styles.messageLabel}>
                  🤖 Assistant:
                </ThemedText>
                <ThemedText style={styles.messageText}>{entry.bot}</ThemedText>
              </ThemedView>
            </ThemedView>
          ))
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  title: { textAlign: 'center', marginBottom: 20 },
  buttonContainer: { marginVertical: 10 },
  statusContainer: { alignItems: 'center', marginVertical: 10 },
  status: { fontSize: 16, fontWeight: '500' },
  conversationContainer: { flex: 1, width: '100%', marginTop: 10 },
  conversationContent: { paddingBottom: 20 },
  emptyState: { textAlign: 'center', marginTop: 40, opacity: 0.6 },
  messageContainer: { marginVertical: 10, gap: 8 },
  userMessage: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#4CAF50',
    backgroundColor: 'rgba(76, 175, 80, 0.1)',
  },
  botMessage: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2196F3',
    backgroundColor: 'rgba(33, 150, 243, 0.1)',
  },
  messageLabel: { marginBottom: 4 },
  messageText: { fontSize: 15, lineHeight: 22 },
});
