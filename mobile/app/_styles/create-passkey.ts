import { StyleSheet } from "react-native";
import { s, vs, fs } from "@/responsive";

export const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  scrollContent: { flexGrow: 1, justifyContent: "center" },
  centered: { justifyContent: "center", alignItems: "center" },
  content: {
    padding: s(24), justifyContent: "center",
    maxWidth: s(400), width: "100%", alignSelf: "center",
  },
  iconContainer: {
    width: s(96), height: s(96), borderRadius: s(24), backgroundColor: "#f0f0f0",
    justifyContent: "center", alignItems: "center", alignSelf: "center", marginBottom: vs(24),
  },
  title: { fontSize: fs(22), fontWeight: "700", color: "#111", textAlign: "center", marginBottom: vs(12) },
  description: { fontSize: fs(15), color: "#666", textAlign: "center", lineHeight: fs(22), marginBottom: vs(24) },
  benefitsCard: { backgroundColor: "#f0fdf4", borderRadius: s(12), padding: s(16), marginBottom: vs(24), gap: vs(14) },
  benefitRow: { flexDirection: "row", alignItems: "center", gap: s(12) },
  benefitText: { fontSize: fs(14), color: "#15803d", fontWeight: "500", flex: 1 },
  input: {
    backgroundColor: "#fff", borderWidth: 1, borderColor: "#ddd",
    borderRadius: s(12), paddingHorizontal: s(16), paddingVertical: vs(14),
    fontSize: fs(16), color: "#111", marginBottom: vs(12),
  },
  passwordRow: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#fff",
    borderWidth: 1, borderColor: "#ddd", borderRadius: s(12), marginBottom: vs(20),
  },
  passwordInput: { flex: 1, paddingHorizontal: s(16), paddingVertical: vs(14), fontSize: fs(16), color: "#111" },
  eyeBtn: { paddingHorizontal: s(14), paddingVertical: vs(14), justifyContent: "center", alignItems: "center" },
  createButton: {
    backgroundColor: "#0a0a0a", borderRadius: s(12), paddingVertical: vs(16),
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: s(10),
  },
  buttonDisabled: { opacity: 0.7 },
  createButtonText: { color: "#fff", fontSize: fs(16), fontWeight: "600" },
  deleteButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: "#fef2f2", borderWidth: 1, borderColor: "#fecaca",
    borderRadius: s(12), paddingVertical: vs(14), gap: s(8), marginBottom: vs(8),
  },
  deleteButtonText: { fontSize: fs(15), fontWeight: "600", color: "#dc2626" },
  cancelButton: { marginTop: vs(12), paddingVertical: vs(12), alignItems: "center" },
  cancelButtonText: { fontSize: fs(15), color: "#666" },
});
