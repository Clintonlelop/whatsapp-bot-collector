import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Phone, Plus, Check, AlertTriangle } from "lucide-react";
import { Contact } from "@/shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

export default function DetectedNumbers() {
  const { toast } = useToast();
  const [autoSave, setAutoSave] = useState(true);

  const { data: contacts, isLoading } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  const saveContactMutation = useMutation({
    mutationFn: async (contactId: string) => {
      return await apiRequest("POST", `/api/contacts/${contactId}/save`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics"] });
      toast({
        title: "Contact Saved",
        description: "Contact has been saved successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save contact",
        variant: "destructive",
      });
    },
  });

  const formatTime = (timestamp: Date | null | undefined) => {
    if (!timestamp) return "";
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatPhoneNumber = (phone: string) => {
    // Simple phone number formatting
    if (phone.startsWith('+1') && phone.length === 12) {
      const digits = phone.substring(2);
      return `+1 (${digits.substring(0, 3)}) ${digits.substring(3, 6)}-${digits.substring(6)}`;
    }
    return phone;
  };

  const getButtonIcon = (contact: Contact) => {
    if (contact.saved) return Check;
    return Plus;
  };

  const getButtonColor = (contact: Contact) => {
    if (contact.saved) return "text-green-600";
    return "text-primary hover:text-primary/80";
  };

  const recentNumbers = contacts?.slice(0, 5) || [];

  if (isLoading) {
    return (
      <Card className="shadow-sm" data-testid="detected-numbers-loading">
        <CardHeader>
          <CardTitle>Recently Detected Numbers</CardTitle>
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
    <Card className="shadow-sm" data-testid="detected-numbers">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Recently Detected Numbers</CardTitle>
          <Button variant="link" className="text-primary hover:text-primary/80" data-testid="button-view-all">
            View All
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {recentNumbers.length === 0 ? (
            <div className="text-center py-8" data-testid="no-numbers">
              <p className="text-muted-foreground">No phone numbers detected yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Numbers will appear here when found in messages
              </p>
            </div>
          ) : (
            recentNumbers.map((contact) => {
              const ButtonIcon = getButtonIcon(contact);
              return (
                <div
                  key={contact.id}
                  className="flex items-center justify-between p-3 bg-muted rounded-lg"
                  data-testid={`detected-number-${contact.id}`}
                >
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-secondary rounded-full flex items-center justify-center">
                      <Phone className="text-white w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground" data-testid={`number-phone-${contact.id}`}>
                        {formatPhoneNumber(contact.phoneNumber)}
                      </p>
                      <p className="text-xs text-muted-foreground" data-testid={`number-source-${contact.id}`}>
                        From: {contact.source}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs text-muted-foreground" data-testid={`number-time-${contact.id}`}>
                      {formatTime(contact.createdAt)}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => saveContactMutation.mutate(contact.id)}
                      disabled={contact.saved || saveContactMutation.isPending}
                      className={getButtonColor(contact)}
                      data-testid={`button-save-${contact.id}`}
                    >
                      <ButtonIcon className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex justify-between text-sm items-center">
            <span className="text-muted-foreground">Auto-save new numbers</span>
            <Switch
              checked={autoSave}
              onCheckedChange={setAutoSave}
              data-testid="switch-auto-save"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
