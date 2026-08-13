import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { MessageCircle, BarChart3, Phone, Users, Download, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";

interface ConnectionStatus {
  connected: boolean;
  qr: string | null;
  initialized: boolean;
  contactCount: number;
}

interface Analytics {
  totalMessages: number;
  detectedNumbers: number;
  newContactsToday: number;
}

export default function Sidebar() {
  const { toast } = useToast();
  const [isConnecting, setIsConnecting] = useState(false);

  const { data: connectionStatus, refetch: refetchStatus } = useQuery<ConnectionStatus>({
    queryKey: ["/api/wa/status"],
    refetchInterval: 5000, // Check status every 5 seconds
  });

  const { data: analytics } = useQuery<Analytics>({
    queryKey: ["/api/analytics"],
  });

  const handleReconnect = async () => {
    try {
      setIsConnecting(true);
      await apiRequest("POST", "/api/wa/connect");
      refetchStatus();
      toast({
        title: "Reconnecting",
        description: "Attempting to reconnect to WhatsApp Web...",
      });
    } catch (error) {
      toast({
        title: "Connection Failed",
        description: "Failed to reconnect to WhatsApp Web",
        variant: "destructive",
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const getStatusColor = (connected?: boolean) => {
    return connected ? "bg-secondary" : "bg-destructive";
  };

  const getStatusText = (connected?: boolean, isConnectingState?: boolean) => {
    if (isConnectingState) return "Connecting...";
    return connected ? "Connected" : "Disconnected";
  };

  return (
    <div className="w-64 bg-card border-r border-border shadow-sm" data-testid="sidebar">
      {/* Header */}
      <div className="p-6 border-b border-border" data-testid="sidebar-header">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-secondary rounded-lg flex items-center justify-center">
            <MessageCircle className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground" data-testid="app-title">
              WhatsApp Collector
            </h1>
            <p className="text-sm text-muted-foreground" data-testid="app-subtitle">
              Message Monitor
            </p>
          </div>
        </div>
      </div>

      {/* Connection Status */}
      <div className="p-4 border-b border-border" data-testid="connection-status">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-foreground">Connection Status</span>
          <div className="flex items-center space-x-2">
            <div 
              className={cn(
                "w-2 h-2 rounded-full",
                getStatusColor(connectionStatus?.connected),
                connectionStatus?.connected ? 'status-dot' : ''
              )}
              data-testid="status-indicator"
            />
            <span 
              className={cn(
                "text-xs font-medium",
                connectionStatus?.connected ? 'text-secondary' : 'text-destructive'
              )}
              data-testid="status-text"
            >
              {getStatusText(connectionStatus?.connected, isConnecting)}
            </span>
          </div>
        </div>
        
        {/* QR Code Display */}
        {!connectionStatus?.connected && connectionStatus?.qr && (
          <div className="mb-4 p-3 bg-card rounded-lg border border-border" data-testid="qr-code-container">
            <p className="text-xs text-muted-foreground mb-3 text-center">
              Scan this QR code with WhatsApp on your phone
            </p>
            <div className="flex justify-center">
              <QRCodeSVG
                value={connectionStatus.qr}
                size={160}
                bgColor="white"
                fgColor="black"
                level="M"
                className="border border-border rounded"
                data-testid="qr-code-image"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-2 text-center">
              Open WhatsApp → Linked Devices → Link a Device
            </p>
          </div>
        )}
        
        <Button
          onClick={handleReconnect}
          disabled={isConnecting}
          className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
          data-testid="button-reconnect"
        >
          <RotateCcw className={cn("w-4 h-4 mr-2", isConnecting && "animate-spin")} />
          {isConnecting ? 'Connecting...' : 'Reconnect'}
        </Button>
      </div>

      {/* Navigation */}
      <nav className="p-4" data-testid="navigation">
        <ul className="space-y-2">
          <li>
            <a
              href="#"
              className="flex items-center space-x-3 text-sm font-medium text-foreground bg-accent px-3 py-2 rounded-md"
              data-testid="nav-dashboard"
            >
              <BarChart3 className="w-4 h-4" />
              <span>Dashboard</span>
            </a>
          </li>
          <li>
            <a
              href="#"
              className="flex items-center space-x-3 text-sm text-muted-foreground hover:text-foreground hover:bg-accent px-3 py-2 rounded-md transition-colors"
              data-testid="nav-messages"
            >
              <MessageCircle className="w-4 h-4" />
              <span>Messages</span>
            </a>
          </li>
          <li>
            <a
              href="#"
              className="flex items-center space-x-3 text-sm text-muted-foreground hover:text-foreground hover:bg-accent px-3 py-2 rounded-md transition-colors"
              data-testid="nav-numbers"
            >
              <Phone className="w-4 h-4" />
              <span>Detected Numbers</span>
            </a>
          </li>
          <li>
            <a
              href="#"
              className="flex items-center space-x-3 text-sm text-muted-foreground hover:text-foreground hover:bg-accent px-3 py-2 rounded-md transition-colors"
              data-testid="nav-contacts"
            >
              <Users className="w-4 h-4" />
              <span>Contacts Database</span>
            </a>
          </li>
          <li>
            <a
              href="#"
              className="flex items-center space-x-3 text-sm text-muted-foreground hover:text-foreground hover:bg-accent px-3 py-2 rounded-md transition-colors"
              data-testid="nav-export"
            >
              <Download className="w-4 h-4" />
              <span>Export</span>
            </a>
          </li>
        </ul>
      </nav>

      {/* Stats Overview */}
      <div className="p-4 mt-auto" data-testid="stats-overview">
        <div className="bg-muted p-3 rounded-lg">
          <h3 className="text-sm font-medium text-foreground mb-2">Today's Activity</h3>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Messages Monitored</span>
              <span className="font-medium" data-testid="today-messages">
                {analytics?.totalMessages || 0}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Numbers Detected</span>
              <span className="font-medium" data-testid="today-numbers">
                {analytics?.detectedNumbers || 0}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">New Contacts</span>
              <span className="font-medium" data-testid="new-contacts">
                {analytics?.newContactsToday || 0}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
