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
import { File } from 'expo-file-system';
import * as Speech from 'expo-speech';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
  Animated,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Icon, IconProps } from '@expo/vector-icons/build/createIconSet';
import { Colors } from '@/constants/theme';

const WORKER_URL = 'https://broken-leaf-2ab3.azaininijar.workers.dev';
const { width } = Dimensions.get('window');

export default function VoiceAssistantScreen() {
  const [permissionGranted, setPermissionGranted] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const player = useAudioPlayer(null);
  const playerStatus = useAudioPlayerStatus(player);
  const [status, setStatus] = useState<'idle' | 'recording' | 'processing'>('idle');
  const [conversation, setConversation] = useState<{ user: string; bot: string }[]>([]);

  const pulseAnim = useState(new Animated.Value(1))[0];
  const fadeAnim = useState(new Animated.Value(0))[0];

  useEffect(() => {
    (async () => {
      const { granted } = await AudioModule.requestRecordingPermissionsAsync();
      setPermissionGranted(granted);
    })();

    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();

    return () => {
      player.remove();
    };
  }, []);

  useEffect(() => {
    if (status === 'recording') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.15,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [status]);

  async function speechToText(audioUri: string): Promise<string> {
    try {
      const file = new File(audioUri);
      const base64data = await file.base64();

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

      if (!result.success || !result.transcript) {
        throw new Error('Invalid STT response');
      }

      return result.transcript;
    } catch (error) {
      console.error('Speech-to-text failed:', error);
      throw error;
    }
  }

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
      await new Promise((resolve) => {
        reader.onloadend = resolve;
      });

      const base64data = (reader.result as string).split(',')[1];
      const fileSource = { uri: `data:audio/mp3;base64,${base64data}`, isStatic: true };

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

  async function handleStartRecording() {
    if (!permissionGranted) {
      Alert.alert('Permission Required', 'Please grant microphone permission.');
      return;
    }
    setStatus('recording');
    await recorder.prepareToRecordAsync();
    recorder.record();
  }

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

  const getStatusConfig = (): {
    icon: any;
    text: string;
    color: string;
  } => {
    switch (status) {
      case 'recording':
        return { icon: 'mic', text: 'Listening...', color: '#d32f2f' };
      case 'processing':
        return { icon: 'autorenew', text: 'Processing...', color: '#1976d2' };
      default:
        return { icon: 'chat', text: 'Ready to chat', color: '#4caf50' };
    }
  };

  const statusConfig = getStatusConfig();

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient
        colors={['#f7f9fc', '#e4e8ef']}
        style={styles.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      >
        <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
          {/* Header */}
          <View style={styles.header}>
            <ThemedText type="title" style={styles.title}>
              Voice Assistant
            </ThemedText>
            <ThemedText style={styles.subtitle}>Tap the microphone to start</ThemedText>
          </View>
          {/* Status */}
          <View style={styles.statusRow}>
            
            {status === 'processing' ? (
               <MaterialIcons
               name={statusConfig.icon}
               size={24}
               color={statusConfig.color}
               style={[styles.statusIcon, {
                transform: [{ rotate: '45deg' }]
               }]}

             />
            ) : (
              <MaterialIcons
              name={statusConfig.icon}
              size={24}
              color={statusConfig.color}
              style={styles.statusIcon}
            />
            )}
            <ThemedText style={[styles.statusText, { color: statusConfig.color }]}>
              {statusConfig.text}
            </ThemedText>
          </View>

          {/* Conversation */}
          <ScrollView
            style={styles.conversationContainer}
            contentContainerStyle={styles.conversationContent}
            showsVerticalScrollIndicator={false}
          >
            {conversation.length === 0 ? (
              <View style={styles.emptyStateContainer}>
                <MaterialCommunityIcons name="microphone" size={64} color="#bbb" />
                <ThemedText style={styles.emptyState}>
                  Start a conversation by tapping the microphone below
                </ThemedText>
              </View>
            ) : (
              conversation.map((entry, index) => (
                <View key={index} style={styles.messageContainer}>
                  {/* User Message */}
                  <View style={[styles.messageBubble, styles.userBubble]}>
                    <ThemedText style={styles.messageLabel}>You</ThemedText>
                    <ThemedText style={styles.messageText}>{entry.user}</ThemedText>
                  </View>

                  {/* Bot Message */}
                  <View style={[styles.messageBubble, styles.botBubble]}>
                    <ThemedText style={styles.messageLabel}>Assistant</ThemedText>
                    <ThemedText style={styles.messageText}>{entry.bot}</ThemedText>
                  </View>
                </View>
              ))
            )}
          </ScrollView>

          {/* Microphone Button */}
          <View style={styles.buttonContainer}>
            <TouchableOpacity
              onPress={status === 'recording' ? handleStopRecording : handleStartRecording}
              disabled={status === 'processing'}
              activeOpacity={0.7}
            >
              <Animated.View
                style={[
                  styles.micButton,
                  {
                    transform: [{ scale: pulseAnim }],
                    backgroundColor: status === 'recording' ? '#d32f2f' : Colors.dark.icon,
                    opacity: status === 'processing' ? 0.6 : 1,
                  },
                ]}
              >
                <MaterialIcons
                  name={status === 'recording' ? 'stop' : 'mic'}
                  size={36}
                  color="#fff"
                />
              </Animated.View>
            </TouchableOpacity>
            <ThemedText style={styles.buttonHint}>
              {status === 'recording' ? 'Tap to stop' : 'Tap to start'}
            </ThemedText>
          </View>
        </Animated.View>
      </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  gradient: {
    flex: 1,
  },
  container: {
    flex: 1,
    padding: 20,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#222',
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#555',
    textAlign: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  statusIcon: {
    marginRight: 8,
  },
  statusText: {
    fontSize: 16,
    fontWeight: '600',
  },
  conversationContainer: {
    flex: 1,
    marginBottom: 20,
  },
  conversationContent: {
    paddingBottom: 20,
  },
  emptyStateContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 60,
  },
  emptyState: {
    textAlign: 'center',
    fontSize: 16,
    color: '#999',
    paddingHorizontal: 40,
    lineHeight: 22,
  },
  messageContainer: {
    marginBottom: 16,
    gap: 4
  },
  messageBubble: {
    borderRadius: 12,
    padding: 12,
    maxWidth: width * 0.85,
    borderWidth: 1,
    borderColor: Colors.dark.icon
  },
  userBubble: {
    backgroundColor: '#e3f2fd',
    alignSelf: 'flex-end',
  },
  botBubble: {
    backgroundColor: '#f1f1f1',
    alignSelf: 'flex-start',
  },
  messageLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#666',
    marginBottom: 6,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#333',
  },
  buttonContainer: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  micButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#222',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  buttonHint: {
    marginTop: 10,
    fontSize: 14,
    color: Colors.dark.text,
    fontWeight: '500',
  },
});
