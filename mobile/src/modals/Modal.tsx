import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Modal as RNModal,
  Dimensions,
  Animated,
  TouchableWithoutFeedback,
  Platform,
  StatusBar,
} from "react-native";
import { styles, touchableOverlayStyle } from "./Modal.styles";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface ModalProps {
  visible: boolean;
  onClose?: () => void;
  children: React.ReactNode;
  /** Fraction of screen height (0-1). Default: 0.9 */
  height?: number;
  animationType?: "slide" | "fade" | "none";
  onAnimationComplete?: () => void;
}

/**
 * Reusable animated bottom-sheet modal.
 *
 * Slides up from the bottom with a dimmed overlay.
 * Respects the safe area so the sheet never overlaps the status bar / notch.
 * Tapping the overlay closes the modal.
 */
const Modal: React.FC<ModalProps> = ({
  visible,
  onClose,
  children,
  height = 0.9,
  onAnimationComplete,
}) => {
  const { height: screenHeight } = Dimensions.get("window");
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(screenHeight)).current;
  const [isVisible, setIsVisible] = useState(visible);

  // Maximum height the sheet can occupy (full screen minus top safe area)
  const statusBarHeight =
    Platform.OS === "android" ? StatusBar.currentHeight ?? 0 : 0;
  const topInset = Math.max(insets.top, statusBarHeight);
  const maxSheetHeight = screenHeight - topInset;
  const sheetHeight = Math.min(screenHeight * height, maxSheetHeight);

  useEffect(() => {
    if (visible) {
      setIsVisible(true);
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 800,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: screenHeight,
        duration: 600,
        useNativeDriver: true,
      }).start(() => {
        setIsVisible(false);
        onAnimationComplete?.();
      });
    }
  }, [visible, slideAnim, screenHeight, onAnimationComplete]);

  if (!isVisible) return null;

  return (
    <RNModal
      visible={isVisible}
      animationType="none"
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
      transparent
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        {/* Tap overlay to close */}
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={touchableOverlayStyle} />
        </TouchableWithoutFeedback>

        <Animated.View
          style={[
            styles.container,
            {
              height: sheetHeight,
              paddingBottom: insets.bottom,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          {/* Drag handle indicator */}
          <View style={styles.handleRow}>
            <View style={styles.handle} />
          </View>

          {children}
        </Animated.View>
      </View>
    </RNModal>
  );
};

export default Modal;
