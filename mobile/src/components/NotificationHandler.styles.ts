import { StyleSheet, Dimensions } from "react-native";
import { s, vs, fs } from "@/responsive";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

export const processingStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: s(24),
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: s(20),
    padding: s(28),
    width: "100%",
    maxWidth: Math.min(SCREEN_WIDTH - s(48), s(320)),
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: vs(8) },
    shadowOpacity: 0.2,
    shadowRadius: s(24),
    elevation: 12,
  },
  iconContainer: {
    marginBottom: vs(16),
  },
  iconCircle: {
    width: s(72),
    height: s(72),
    borderRadius: s(36),
    alignItems: "center",
    justifyContent: "center",
  },
  iconCircleDefault: {
    backgroundColor: "#f5f5f5",
  },
  iconCircleSuccess: {
    backgroundColor: "#f0fdf4",
  },
  iconCircleError: {
    backgroundColor: "#fef2f2",
  },
  title: {
    fontSize: fs(18),
    fontWeight: "700",
    color: "#0a0a0a",
    textAlign: "center",
    marginBottom: vs(6),
  },
  subtitle: {
    fontSize: fs(14),
    color: "#666",
    textAlign: "center",
    lineHeight: fs(20),
    marginBottom: vs(8),
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: s(4),
    marginTop: vs(12),
  },
  badgeText: {
    fontSize: fs(11),
    color: "#999",
    fontWeight: "500",
  },
});
