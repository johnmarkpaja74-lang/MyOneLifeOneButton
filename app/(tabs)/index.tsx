import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
// ============================================
// SIGNAL DRIFT - A One-Button Rhythm Game
// ============================================
// Concept: Tap when the orbiting signal aligns with the target zone
// One miss ends the run! (rogue-like difficulty)
//
// Features:
// - Multiple zone types: Main (points), Bonus (buff), Debuff (penalty), Multiplier
// - Sound effects via expo-av
// - Haptic feedback via expo-haptics
// - High score persistence via AsyncStorage
// - Smooth animations via requestAnimationFrame

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

type Phase = 'start' | 'playing' | 'gameover';

type Zone = {
  center: number;
  width: number;
};

// ============================================
// GAME CONFIGURATION CONSTANTS
// ============================================
const TAU = Math.PI * 2;
const BASE_SPEED = 1.65; // radians per second
const SPEED_STEP = 0.16;
const MIN_ZONE_WIDTH = 0.35;
const BASE_ZONE_WIDTH = 1.1;
const BONUS_ZONE_WIDTH = 0.35;
const BONUS_CHANCE = 0.45;
const BONUS_SLOW = 0.5;
const BONUS_WIDEN = 0.35;
const DEBUFF_ZONE_WIDTH = 0.32;
const DEBUFF_CHANCE = 0.3;
const DEBUFF_SPEED = 0.6;
const DEBUFF_SHRINK = 0.25;
const MAX_MULTIPLIER = 4;
const BEST_KEY = 'signal-drift-best';
const MULTIPLIER_ZONE_WIDTH = 0.45;
const MULTIPLIER_CHANCE = 0.5;
const DOT_RADIUS = 9;
const ORBIT_PADDING = 40;

// ============================================
// UTILITY FUNCTIONS
// ============================================

// Normalize angle to 0-Tau range (0 to 2*PI)
function normalizeAngle(angle: number) {
  let a = angle % TAU;
  if (a < 0) a += TAU;
  return a;
}

// Calculate shortest distance between two angles
function angleDistance(a: number, b: number) {
  const d = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return Math.min(d, TAU - d);
}

// Generate a random zone (arc segment on the circle)
function randomZone(width: number) {
  return {
    center: Math.random() * TAU,
    width,
  } satisfies Zone;
}

// ============================================
// MAIN GAME COMPONENT
// ============================================
export default function HomeScreen() {
  const { width, height } = useWindowDimensions();
  const ringSize = Math.min(width - 32, height - 220);
  const ringRadius = ringSize / 2;
  const orbitRadius = ringRadius - ORBIT_PADDING;

  // ============================================
  // STATE: Game phase (start/playing/gameover)
  // ============================================
  const [phase, setPhase] = useState<Phase>('start');
  
  // Score tracking
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  
  // Combo and multiplier for bonus points
  const [combo, setCombo] = useState(0);
  const [multiplier, setMultiplier] = useState(1);
  
  // Current angle of the orbiting signal (in radians)
  const [angle, setAngle] = useState(0);
  
  // Zone positions (randomly generated arcs on the circle)
  const [zone, setZone] = useState<Zone>(() => randomZone(BASE_ZONE_WIDTH));
  const [bonusZone, setBonusZone] = useState<Zone | null>(null);
  const [debuffZone, setDebuffZone] = useState<Zone | null>(null);
  const [multiplierZone, setMultiplierZone] = useState<Zone | null>(null);
  
  // Popup text messages (shown briefly on screen)
  const [buffText, setBuffText] = useState('');
  const [debuffText, setDebuffText] = useState('');
  const [perfectText, setPerfectText] = useState('');
  const [multiplierText, setMultiplierText] = useState('');
  
  // Screen flash effect color
  const [flashColor, setFlashColor] = useState('');

  // ============================================
  // REFS: Mutable values that don't trigger re-renders
  // (Used in game loop to avoid closure staleness)
  // ============================================
  const angleRef = useRef(0);           // Current orbit angle
  const speedRef = useRef(BASE_SPEED);  // Current rotation speed
  const directionRef = useRef<1 | -1>(1); // Rotation direction (1 or -1)
  const zoneRef = useRef(zone);          // Current target zone
  const bonusRef = useRef<Zone | null>(null);   // Bonus zone
  const debuffRef = useRef<Zone | null>(null);  // Debuff zone
  const multiplierRef = useRef<Zone | null>(null); // Multiplier zone
  const scoreRef = useRef(0);            // Current score
  const comboRef = useRef(0);            // Current combo
  const multiplierValueRef = useRef(1);  // Current multiplier value
  const phaseRef = useRef<Phase>('start'); // Current phase
  
  // Audio sound objects
  const hitSoundRef = useRef<Audio.Sound | null>(null);
  const missSoundRef = useRef<Audio.Sound | null>(null);
  const perfectSoundRef = useRef<Audio.Sound | null>(null);
  const buffSoundRef = useRef<Audio.Sound | null>(null);
  const debuffSoundRef = useRef<Audio.Sound | null>(null);
  
  // Last frame timestamp for delta time calculation
  const lastTickRef = useRef<number | null>(null);

  // ============================================
  // EFFECTS: Sync refs with state and handle side effects
  // ============================================

  // Sync angle ref with state
  useEffect(() => {
    angleRef.current = angle;
  }, [angle]);

  // Sync zone ref with state
  useEffect(() => {
    zoneRef.current = zone;
  }, [zone]);

  // Sync bonus zone ref
  useEffect(() => {
    bonusRef.current = bonusZone;
  }, [bonusZone]);

  // Sync debuff zone ref
  useEffect(() => {
    debuffRef.current = debuffZone;
  }, [debuffZone]);

  // Sync multiplier zone ref
  useEffect(() => {
    multiplierRef.current = multiplierZone;
  }, [multiplierZone]);

  // ============================================
  // TIMERS: Auto-clear popup text after display
  // ============================================

  // Clear buff text after 700ms
  useEffect(() => {
    if (!buffText) return;
    const id = setTimeout(() => setBuffText(''), 700);
    return () => clearTimeout(id);
  }, [buffText]);

  // Clear debuff text after 700ms
  useEffect(() => {
    if (!debuffText) return;
    const id = setTimeout(() => setDebuffText(''), 700);
    return () => clearTimeout(id);
  }, [debuffText]);

  // Clear perfect text after 700ms
  useEffect(() => {
    if (!perfectText) return;
    const id = setTimeout(() => setPerfectText(''), 700);
    return () => clearTimeout(id);
  }, [perfectText]);

  // Clear multiplier text after 700ms
  useEffect(() => {
    if (!multiplierText) return;
    const id = setTimeout(() => setMultiplierText(''), 700);
    return () => clearTimeout(id);
  }, [multiplierText]);

  // Clear flash effect after 140ms
  useEffect(() => {
    if (!flashColor) return;
    const id = setTimeout(() => setFlashColor(''), 140);
    return () => clearTimeout(id);
  }, [flashColor]);

  // Sync phase ref with state
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // ============================================
  // PERSISTENCE: Load best score from AsyncStorage
  // ============================================
  useEffect(() => {
    const loadBest = async () => {
      try {
        const stored = await AsyncStorage.getItem(BEST_KEY);
        if (stored) setBest(Number(stored));
      } catch {
        // ignore
      }
    };
    void loadBest();
  }, []);

  // ============================================
  // AUDIO: Load sound effects on mount
  // ============================================
  useEffect(() => {
    const loadSounds = async () => {
      try {
        // Enable audio in silent mode (iOS)
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
        
        // Load all sound effects
        const hit = await Audio.Sound.createAsync(
          require('../../assets/sounds/hit.wav'),
          { volume: 0.6 }
        );
        const miss = await Audio.Sound.createAsync(
          require('../../assets/sounds/miss.wav'),
          { volume: 0.7 }
        );
        const perfect = await Audio.Sound.createAsync(
          require('../../assets/sounds/perfect.wav'),
          { volume: 0.7 }
        );
        const buff = await Audio.Sound.createAsync(
          require('../../assets/sounds/buff.wav'),
          { volume: 0.6 }
        );
        const debuff = await Audio.Sound.createAsync(
          require('../../assets/sounds/debuff.wav'),
          { volume: 0.6 }
        );
        
        // Store sound references
        hitSoundRef.current = hit.sound;
        missSoundRef.current = miss.sound;
        perfectSoundRef.current = perfect.sound;
        buffSoundRef.current = buff.sound;
        debuffSoundRef.current = debuff.sound;
      } catch {
        // ignore
      }
    };

    void loadSounds();
    
    // Cleanup: unload sounds on unmount
    return () => {
      void hitSoundRef.current?.unloadAsync();
      void missSoundRef.current?.unloadAsync();
      void perfectSoundRef.current?.unloadAsync();
      void buffSoundRef.current?.unloadAsync();
      void debuffSoundRef.current?.unloadAsync();
    };
  }, []);

  // ============================================
  // PERSISTENCE: Auto-save best score when updated
  // ============================================
  useEffect(() => {
    if (!best) return;
    void AsyncStorage.setItem(BEST_KEY, String(best));
  }, [best]);

  // ============================================
  // GAME LOOP: Animation frame for smooth orbit
  // ============================================
  useEffect(() => {
    // Only run during playing phase
    if (phase !== 'playing') return;

    let frame = 0;
    
    // Animation loop using requestAnimationFrame
    const loop = (now: number) => {
      // Stop if game ended
      if (phaseRef.current !== 'playing') return;
      
      // Calculate delta time for frame-rate independence
      if (!lastTickRef.current) lastTickRef.current = now;
      const dt = Math.min(0.032, (now - lastTickRef.current) / 1000); // Cap at 32ms
      lastTickRef.current = now;
      
      // Update angle based on speed, direction, and delta time
      const next = normalizeAngle(angleRef.current + speedRef.current * directionRef.current * dt);
      angleRef.current = next;
      setAngle(next);
      
      // Schedule next frame
      frame = requestAnimationFrame(loop);
    };

    frame = requestAnimationFrame(loop);
    
    // Cleanup: cancel animation on unmount or phase change
    return () => {
      lastTickRef.current = null;
      cancelAnimationFrame(frame);
    };
  }, [phase]);

  // ============================================
  // CALLBACKS: Game actions
  // ============================================

  // Start a new game
  const startGame = useCallback(() => {
    // Reset all game state
    scoreRef.current = 0;
    comboRef.current = 0;
    multiplierValueRef.current = 1;
    speedRef.current = BASE_SPEED;
    directionRef.current = 1;
    lastTickRef.current = null;
    
    setScore(0);
    setCombo(0);
    setMultiplier(1);
    setZone(randomZone(BASE_ZONE_WIDTH));
    setBonusZone(null);
    setDebuffZone(null);
    setMultiplierZone(null);
    setAngle(0);
    angleRef.current = 0;
    setPhase('playing');
  }, []);

  // End the game (called on miss)
  const endGame = useCallback(() => {
    setPhase('gameover');
    setBest((prev) => Math.max(prev, scoreRef.current));
  }, []);

  // ============================================
  // MAIN INPUT HANDLER: Process player taps
  // ============================================
  const handlePress = useCallback(() => {
    // Start game if at start screen
    if (phaseRef.current === 'start') {
      startGame();
      return;
    }
    // Restart if at game over screen
    if (phaseRef.current === 'gameover') {
      startGame();
      return;
    }

    // Game is playing - process the tap
    const now = performance.now();
    
    // Quick angle update for responsive feel
    if (lastTickRef.current) {
      const dt = Math.min(0.05, (now - lastTickRef.current) / 1000);
      if (dt > 0) {
        const next = normalizeAngle(
          angleRef.current + speedRef.current * directionRef.current * dt
        );
        angleRef.current = next;
        lastTickRef.current = now;
        setAngle(next);
      }
    }

    // Get current zone positions
    const currentZone = zoneRef.current;
    const currentBonus = bonusRef.current;
    const currentDebuff = debuffRef.current;
    const currentMultiplier = multiplierRef.current;
    
    // Check if signal is within each zone
    const hitMain = angleDistance(angleRef.current, currentZone.center) <= currentZone.width / 2;
    const hitBonus =
      currentBonus && angleDistance(angleRef.current, currentBonus.center) <= currentBonus.width / 2;
    const hitDebuff =
      currentDebuff && angleDistance(angleRef.current, currentDebuff.center) <= currentDebuff.width / 2;
    const hitMultiplier =
      currentMultiplier &&
      angleDistance(angleRef.current, currentMultiplier.center) <= currentMultiplier.width / 2;
    
    // Perfect hit: within 10% of zone center
    const perfect =
      hitMain && angleDistance(angleRef.current, currentZone.center) <= currentZone.width * 0.1;

    // MISS: No zone hit - game over!
    if (!hitMain && !hitBonus && !hitDebuff && !hitMultiplier) {
      endGame();
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      void missSoundRef.current?.replayAsync();
      return;
    }

    // HIT: Process successful hit
    comboRef.current += 1;
    setCombo(comboRef.current);

    // Handle multiplier zone (increases score multiplier)
    if (hitMultiplier) {
      const nextMultiplier = Math.min(MAX_MULTIPLIER, multiplierValueRef.current + 1);
      multiplierValueRef.current = nextMultiplier;
      setMultiplier(nextMultiplier);
      setMultiplierText(`Multiplier x${nextMultiplier}`);
    } else {
      // Normal score: base points + perfect bonus, multiplied
      const basePoints = 1 + (perfect ? 1 : 0);
      scoreRef.current += basePoints * multiplierValueRef.current;
      setScore(scoreRef.current);
    }
    
    // Haptic and sound feedback
    void Haptics.impactAsync(
      perfect ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light
    );
    void hitSoundRef.current?.replayAsync();

    // Increase speed and flip direction after each hit
    const nextSpeed = speedRef.current + SPEED_STEP;
    speedRef.current = nextSpeed;
    directionRef.current = (directionRef.current * -1) as 1 | -1;

    // Calculate next zone width (shrinks as score increases)
    let nextWidth = Math.max(MIN_ZONE_WIDTH, BASE_ZONE_WIDTH - scoreRef.current * 0.05);
    
    // Apply bonus zone effects (slow down + widen)
    if (hitBonus) {
      speedRef.current = Math.max(BASE_SPEED, speedRef.current - BONUS_SLOW);
      nextWidth = Math.min(BASE_ZONE_WIDTH + BONUS_WIDEN, nextWidth + BONUS_WIDEN);
      setBuffText('Stabilized!');
      void buffSoundRef.current?.replayAsync();
    }
    
    // Apply debuff zone effects (speed up + shrink)
    if (hitDebuff) {
      speedRef.current = speedRef.current + DEBUFF_SPEED;
      nextWidth = Math.max(MIN_ZONE_WIDTH, nextWidth - DEBUFF_SHRINK);
      setDebuffText('Overload!');
      void debuffSoundRef.current?.replayAsync();
    }
    
    // Perfect hit bonus
    if (perfect) {
      setPerfectText('Perfect +1');
      setFlashColor('rgba(160, 255, 250, 0.22)');
      void perfectSoundRef.current?.replayAsync();
    }
    
    // Generate new zones for next round
    const newZone = randomZone(nextWidth);
    setZone(newZone);
    setBonusZone(Math.random() < BONUS_CHANCE ? randomZone(BONUS_ZONE_WIDTH) : null);
    setDebuffZone(Math.random() < DEBUFF_CHANCE ? randomZone(DEBUFF_ZONE_WIDTH) : null);
    setMultiplierZone(Math.random() < MULTIPLIER_CHANCE ? randomZone(MULTIPLIER_ZONE_WIDTH) : null);
  }, [endGame, startGame]);

  // ============================================
  // COMPUTED VALUES: Derived from state
  // ============================================

  // Calculate signal dot position (polar to cartesian)
  const orbitX = ringRadius + orbitRadius * Math.cos(angle - Math.PI / 2);
  const orbitY = ringRadius + orbitRadius * Math.sin(angle - Math.PI / 2);

  // Generate dots for main zone (green) - 9 dots along the arc
  const zoneLines = useMemo(() => {
    const dots = 9;
    const start = zone.center - zone.width / 2;
    const step = zone.width / (dots - 1);
    return Array.from({ length: dots }, (_, i) => normalizeAngle(start + step * i));
  }, [zone.center, zone.width]);

  // Generate dots for multiplier zone (yellow) - 7 dots
  const multiplierLines = useMemo(() => {
    if (!multiplierZone) return [];
    const dots = 7;
    const start = multiplierZone.center - multiplierZone.width / 2;
    const step = multiplierZone.width / (dots - 1);
    return Array.from({ length: dots }, (_, i) => normalizeAngle(start + step * i));
  }, [multiplierZone]);

  // Generate dots for bonus zone (pink) - 6 dots
  const bonusLines = useMemo(() => {
    if (!bonusZone) return [];
    const dots = 6;
    const start = bonusZone.center - bonusZone.width / 2;
    const step = bonusZone.width / (dots - 1);
    return Array.from({ length: dots }, (_, i) => normalizeAngle(start + step * i));
  }, [bonusZone]);

  // Generate dots for debuff zone (red) - 6 dots
  const debuffLines = useMemo(() => {
    if (!debuffZone) return [];
    const dots = 6;
    const start = debuffZone.center - debuffZone.width / 2;
    const step = debuffZone.width / (dots - 1);
    return Array.from({ length: dots }, (_, i) => normalizeAngle(start + step * i));
  }, [debuffZone]);

  // Hint text based on game phase
  const hintText =
    phase === 'playing'
      ? 'Tap the bright arc. Thin lines can buff or debuff.'
      : phase === 'gameover'
        ? 'One miss ends the run.'
        : 'One button. One life.';

  // Ring glow intensity based on combo (visual feedback)
  const glow = Math.min(1, combo / 14);
  // ============================================
  // RENDER: UI Components
  // ============================================
  
  // Ring style based on combo glow
  const ringStyle = {
    borderColor: `rgba(78, 244, 255, ${0.2 + glow * 0.75})`,
    shadowOpacity: 0.2 + glow * 0.6,
    shadowRadius: 16 + glow * 10,
  } as const;

  return (
    // Main touch area - handles all game input
    <Pressable style={styles.screen} onPressIn={handlePress}>
      {/* Header: Title and stats */}
      <View style={styles.header}>
        <Text style={styles.title}>Signal Drift</Text>
        <View style={styles.stats}>
          <Text style={styles.statText}>Score: {score}</Text>
          <Text style={styles.statText}>Best: {best}</Text>
          <Text style={styles.statText}>Streak: {combo} x{multiplier}</Text>
        </View>
      </View>

      {/* Game Ring: The main visual component */}
      <View style={[styles.ringWrap, { width: ringSize, height: ringSize }]}>
        <View style={[styles.ring, ringStyle]} />
        {zoneLines.map((dotAngle, index) => {
          const x = ringRadius + orbitRadius * Math.cos(dotAngle - Math.PI / 2);
          const y = ringRadius + orbitRadius * Math.sin(dotAngle - Math.PI / 2);
          return (
            <View
              key={`${dotAngle}-${index}`}
              style={[
                styles.zoneLine,
                {
                  left: x,
                  top: y,
                  opacity: 0.45 + index / zoneLines.length,
                  transform: [
                    { translateX: -8 },
                    { translateY: -1 },
                    { rotate: `${dotAngle}rad` },
                  ],
                },
              ]}
            />
          );
        })}

        {multiplierLines.map((dotAngle, index) => {
          const x = ringRadius + orbitRadius * Math.cos(dotAngle - Math.PI / 2);
          const y = ringRadius + orbitRadius * Math.sin(dotAngle - Math.PI / 2);
          return (
            <View
              key={`${dotAngle}-${index}-multiplier`}
              style={[
                styles.multiplierLine,
                {
                  left: x,
                  top: y,
                  opacity: 0.35 + index / multiplierLines.length,
                  transform: [
                    { translateX: -7 },
                    { translateY: -1 },
                    { rotate: `${dotAngle}rad` },
                  ],
                },
              ]}
            />
          );
        })}

        {bonusLines.map((dotAngle, index) => {
          const x = ringRadius + orbitRadius * Math.cos(dotAngle - Math.PI / 2);
          const y = ringRadius + orbitRadius * Math.sin(dotAngle - Math.PI / 2);
          return (
            <View
              key={`${dotAngle}-${index}-bonus`}
              style={[
                styles.bonusLine,
                {
                  left: x,
                  top: y,
                  opacity: 0.5 + index / bonusLines.length,
                  transform: [
                    { translateX: -6 },
                    { translateY: -1 },
                    { rotate: `${dotAngle}rad` },
                  ],
                },
              ]}
            />
          );
        })}

        {debuffLines.map((dotAngle, index) => {
          const x = ringRadius + orbitRadius * Math.cos(dotAngle - Math.PI / 2);
          const y = ringRadius + orbitRadius * Math.sin(dotAngle - Math.PI / 2);
          return (
            <View
              key={`${dotAngle}-${index}-debuff`}
              style={[
                styles.debuffLine,
                {
                  left: x,
                  top: y,
                  opacity: 0.5 + index / debuffLines.length,
                  transform: [
                    { translateX: -6 },
                    { translateY: -1 },
                    { rotate: `${dotAngle}rad` },
                  ],
                },
              ]}
            />
          );
        })}

        <View
          style={[
            styles.signal,
            {
              left: orbitX - DOT_RADIUS,
              top: orbitY - DOT_RADIUS,
              width: DOT_RADIUS * 2,
              height: DOT_RADIUS * 2,
              borderRadius: DOT_RADIUS,
            },
          ]}
        />
        <View style={styles.core} />
      </View>

      {/* Footer: Action prompt and hints */}
      <View style={styles.footer}>
        {phase === 'start' && <Text style={styles.action}>Tap to start</Text>}
        {phase === 'playing' && <Text style={styles.action}>Tap to lock</Text>}
        {phase === 'gameover' && <Text style={styles.action}>Tap to retry</Text>}
        <Text style={styles.hint}>{hintText}</Text>
      </View>

      {/* Fixed position popup overlay - no layout shift */}
      <View style={styles.popupOverlay} pointerEvents="none">
        {!!buffText && <Text style={styles.buff}>{buffText}</Text>}
        {!!debuffText && <Text style={styles.debuff}>{debuffText}</Text>}
        {!!perfectText && <Text style={styles.perfect}>{perfectText}</Text>}
        {!!multiplierText && <Text style={styles.multiplierText}>{multiplierText}</Text>}
      </View>

      {/* Game Over Overlay */}
      {phase === 'gameover' && (
        <View style={styles.overlay}>
          <Text style={styles.overlayTitle}>Signal Lost</Text>
          <Text style={styles.overlayScore}>Final Score: {score}</Text>
          <Text style={styles.overlayTip}>Tap anywhere to restart</Text>
        </View>
      )}
      
      {/* Screen flash effect */}
      {!!flashColor && <View pointerEvents="none" style={[styles.flash, { backgroundColor: flashColor }]} />}
    </Pressable>
  );
}

// ============================================
// STYLES: Component styling
// ============================================
const styles = StyleSheet.create({
  // Main screen container
  screen: {
    flex: 1,
    backgroundColor: '#0c0f12',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 48,
    paddingBottom: 40,
  },
  
  // Header section (title + stats)
  header: {
    alignItems: 'center',
    gap: 6,
  },
  title: {
    color: '#f0f6ff',
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  stats: {
    flexDirection: 'row',
    gap: 18,
  },
  statText: {
    color: '#b8c7db',
    fontSize: 14,
    fontWeight: '600',
  },
  
  // Game ring container
  ringWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  // Outer ring (glow effect)
  ring: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    borderRadius: 999,
    borderWidth: 3,
    borderColor: 'rgba(78, 244, 255, 0.25)',
    shadowColor: '#0b0e14',
    shadowOpacity: 0.8,
    shadowRadius: 16,
  },
  
  // Zone dots (green - main zone)
  zoneLine: {
    position: 'absolute',
    width: 16,
    height: 2,
    borderRadius: 2,
    backgroundColor: '#3af28d',
  },
  
  // Multiplier zone dots (yellow)
  multiplierLine: {
    position: 'absolute',
    width: 14,
    height: 2,
    borderRadius: 2,
    backgroundColor: '#ffd36a',
  },
  
  // Bonus zone dots (pink)
  bonusLine: {
    position: 'absolute',
    width: 12,
    height: 2,
    borderRadius: 2,
    backgroundColor: '#ff8fd6',
  },
  
  // Debuff zone dots (red)
  debuffLine: {
    position: 'absolute',
    width: 12,
    height: 2,
    borderRadius: 2,
    backgroundColor: '#ff6b6b',
  },
  
  // The orbiting signal dot
  signal: {
    position: 'absolute',
    backgroundColor: '#f8ffb0',
    shadowColor: '#f8ffb0',
    shadowOpacity: 0.9,
    shadowRadius: 12,
  },
  
  // Center core (decorative)
  core: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#384655',
    borderWidth: 2,
    borderColor: '#5c6b7a',
  },
  
  // Footer area (action text + hints)
  footer: {
    alignItems: 'center',
    gap: 6,
  },
  
  // Popup text overlay (center of screen)
  popupOverlay: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  
  // Action prompt text
  action: {
    color: '#f0f6ff',
    fontSize: 18,
    fontWeight: '700',
  },
  
  // Hint text
  hint: {
    color: '#93a4bb',
    fontSize: 13,
  },
  
  // Buff popup text (pink)
  buff: {
    color: '#ffd36a',
    fontSize: 13,
    fontWeight: '700',
  },
  
  // Debuff popup text (red)
  debuff: {
    color: '#ff9b9b',
    fontSize: 13,
    fontWeight: '700',
  },
  
  // Perfect hit popup (cyan)
  perfect: {
    color: '#baf9ff',
    fontSize: 13,
    fontWeight: '800',
  },
  
  // Multiplier popup (yellow)
  multiplierText: {
    color: '#ffe38a',
    fontSize: 13,
    fontWeight: '800',
  },
  
  // Screen flash effect
  flash: {
    ...StyleSheet.absoluteFillObject,
  },
  
  // Game over overlay
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(3,6,10,0.68)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 24,
  },
  overlayTitle: {
    color: '#f0f6ff',
    fontSize: 28,
    fontWeight: '800',
  },
  overlayScore: {
    color: '#c7d4e8',
    fontSize: 16,
    fontWeight: '600',
  },
  overlayTip: {
    color: '#8ea1bb',
    fontSize: 13,
  },
});
