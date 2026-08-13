import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Phone, UserPlus, CheckCircle } from "lucide-react";
import { Message } from "@/shared/schema";

export default function RecentMessages() {
  const { data: messages, isLoading } = useQuery<Message[]>({
    queryKey: ["/api/messages"],
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  const formatTime = (timestamp: Date | null | undefined) => {
    if (!timestamp) return "";
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const getInitials = (sender: string) => {
    return sender.split(' ').map(word => word[0]).join('').toUpperCase().substring(0, 2);
  };

  const getBadgeInfo = (message: Message) => {
    const hasNumbers = message.phoneNumbersDetected && message.phoneNumbersDetected.length > 0;
    if (!hasNumbers) return null;

    return {
      icon: Phone,
      text: "Number Detected",
      className: "bg-green-100 text-green-700",
    };
  };

  if (isLoading) {
    return (
      <Card className="shadow-sm" data-testid="recent-messages-loading">
        <CardHeader>
          <CardTitle>Recent Messages</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm" data-testid="recent-messages">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Recent Messages</CardTitle>
          <span className="text-sm text-muted-foreground">Live monitoring</span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 max-h-80 overflow-y-auto">
          {!messages || messages.length === 0 ? (
            <div className="text-center py-8" data-testid="no-messages">
              <p className="text-muted-foreground">No messages yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Messages will appear here once WhatsApp is connected
              </p>
            </div>
          ) : (
            messages.map((message) => {
              const badgeInfo = getBadgeInfo(message);
              return (
                <div
                  key={message.id}
                  className="flex items-start space-x-3 p-3 bg-muted rounded-lg"
                  data-testid={`message-${message.id}`}
                >
                  <div className="w-10 h-10 bg-secondary rounded-full flex items-center justify-center text-white text-sm font-medium">
                    {getInitials(message.sender)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-foreground truncate" data-testid={`message-sender-${message.id}`}>
                        {message.sender}
                      </p>
                      <span className="text-xs text-muted-foreground" data-testid={`message-time-${message.id}`}>
                        {formatTime(message.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2" data-testid={`message-content-${message.id}`}>
                      {message.content}
                    </p>
                    {badgeInfo && (
                      <div className="mt-2">
                        <Badge className={badgeInfo.className} data-testid={`message-badge-${message.id}`}>
                          <badgeInfo.icon className="w-3 h-3 mr-1" />
                          {badgeInfo.text}
                        </Badge>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}
