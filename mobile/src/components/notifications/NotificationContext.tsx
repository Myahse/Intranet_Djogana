import { registerForPushNotificationsAsync } from "@/components/notifications/utils";
import * as Notifications from "expo-notifications";
import React, {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

interface NotificationContextType {
  /** Native FCM device token (Android) or APNs token (iOS) */
  fcmToken: string | null;
  notification: Notifications.Notification | null;
  error: Error | null;
}

const NotificationContext = createContext<NotificationContextType | undefined>(
  undefined
);

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error(
      "useNotification must be used within a NotificationProvider"
    );
  }
  return context;
};

interface NotificationProviderProps {
  children: ReactNode;
}

export const NotificationProvider: React.FC<NotificationProviderProps> = ({
  children,
}) => {
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  const [notification, setNotification] =
    useState<Notifications.Notification | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const notificationListener = useRef<Notifications.EventSubscription | null>(
    null
  );

  useEffect(() => {
    // Obtain the native FCM device token (permissions + device token)
    registerForPushNotificationsAsync().then(
      (token) => setFcmToken(token),
      (err) => setError(err)
    );

    // Store incoming notifications in state so any component can react to them
    notificationListener.current =
      Notifications.addNotificationReceivedListener((incoming) => {
        setNotification(incoming);
      });

    return () => {
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
    };
  }, []);

  return (
    <NotificationContext.Provider
      value={{ fcmToken, notification, error }}
    >
      {children}
    </NotificationContext.Provider>
  );
};
