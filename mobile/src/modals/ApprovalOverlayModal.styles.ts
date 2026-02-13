import { StyleSheet, Dimensions } from "react-native";
import { s, vs, fs } from "@/responsive";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

export const styles = StyleSheet.create({
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
    maxWidth: Math.min(SCREEN_WIDTH - s(48), s(360)),
    shadowColor: "#000",
    shadowOffset: { width: 0, height: vs(8) },
    shadowOpacity: 0.2,
    shadowRadius: s(24),
    elevation: 12,
  },

  /* Icon */
  iconContainer: {
    alignItems: "center",
    marginBottom: vs(16),
  },
  iconCircle: {
    width: s(64),
    height: s(64),
    borderRadius: s(32),
    alignItems: "center",
    justifyContent: "center",
  },
  iconCircleDefault: {
    backgroundColor: "#f5f5f5",
  },
  iconCircleSuccess: {
    backgroundColor: "#f0fdf4",
  },
  iconCircleDenied: {
    backgroundColor: "#fef2f2",
  },

  /* Title & subtitle */
  title: {
    fontSize: fs(20),
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
    marginBottom: vs(20),
  },

  /* Code display */
  codeContainer: {
    backgroundColor: "#f9fafb",
    borderRadius: s(12),
    paddingVertical: vs(16),
    paddingHorizontal: s(20),
    alignItems: "center",
    marginBottom: vs(16),
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  codeLabel: {
    fontSize: fs(11),
    fontWeight: "600",
    color: "#888",
    textTransform: "uppercase",
    letterSpacing: s(1),
    marginBottom: vs(6),
  },
  code: {
    fontSize: fs(32),
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
    letterSpacing: s(6),
    color: "#0a0a0a",
  },

  /* Waiting indicator */
  timerSection: {
    marginBottom: vs(20),
  },
  timerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: s(4),
    marginBottom: vs(8),
  },
  timerText: {
    fontSize: fs(13),
    fontWeight: "600",
  },

  /* Buttons */
  actions: {
    flexDirection: "row",
    gap: s(12),
  },
  btn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: vs(14),
    borderRadius: s(12),
    gap: s(6),
  },
  btnApprove: {
    backgroundColor: "#0a0a0a",
  },
  btnApproveText: {
    color: "#fff",
    fontSize: fs(15),
    fontWeight: "700",
  },
  btnDeny: {
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: "#fecaca",
  },
  btnDenyText: {
    color: "#dc2626",
    fontSize: fs(15),
    fontWeight: "700",
  },

  /* Close button (for expired/error states) */
  closeBtn: {
    backgroundColor: "#f0f0f0",
    borderRadius: s(12),
    paddingVertical: vs(14),
    alignItems: "center",
  },
  closeBtnText: {
    fontSize: fs(15),
    fontWeight: "600",
    color: "#333",
  },

  /* Security badge */
  securityBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: s(4),
    marginTop: vs(16),
  },
  securityText: {
    fontSize: fs(11),
    color: "#999",
    fontWeight: "500",
  },
});
