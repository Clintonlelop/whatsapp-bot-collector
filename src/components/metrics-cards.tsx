import { Card, CardContent } from "@/components/ui/card";
import { Mail, Phone, Users, Download } from "lucide-react";

interface Analytics {
  totalMessages: number;
  detectedNumbers: number;
  totalContacts: number;
  newContactsToday: number;
}

interface MetricsCardsProps {
  analytics?: Analytics;
}

export default function MetricsCards({ analytics }: MetricsCardsProps) {
  const metrics = [
    {
      title: "Total Messages",
      value: analytics?.totalMessages || 0,
      icon: Mail,
      bgColor: "bg-blue-100",
      iconColor: "text-blue-600",
      change: "+12%",
      changeColor: "text-green-600",
      testId: "metric-total-messages"
    },
    {
      title: "Detected Numbers", 
      value: analytics?.detectedNumbers || 0,
      icon: Phone,
      bgColor: "bg-green-100",
      iconColor: "text-green-600",
      change: "+8%",
      changeColor: "text-green-600",
      testId: "metric-detected-numbers"
    },
    {
      title: "Saved Contacts",
      value: analytics?.totalContacts || 0,
      icon: Users,
      bgColor: "bg-purple-100",
      iconColor: "text-purple-600",
      change: "+15%",
      changeColor: "text-green-600",
      testId: "metric-saved-contacts"
    },
    {
      title: "Export Files",
      value: 0, // This would need to come from analytics
      icon: Download,
      bgColor: "bg-orange-100",
      iconColor: "text-orange-600",
      change: "+5%",
      changeColor: "text-green-600",
      testId: "metric-export-files"
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6" data-testid="metrics-cards">
      {metrics.map((metric) => {
        const IconComponent = metric.icon;
        return (
          <Card key={metric.title} className="shadow-sm" data-testid={metric.testId}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{metric.title}</p>
                  <p className="text-2xl font-bold text-foreground" data-testid={`${metric.testId}-value`}>
                    {metric.value.toLocaleString()}
                  </p>
                </div>
                <div className={`w-12 h-12 ${metric.bgColor} rounded-lg flex items-center justify-center`}>
                  <IconComponent className={`w-6 h-6 ${metric.iconColor}`} />
                </div>
              </div>
              <div className="mt-4 flex items-center text-sm">
                <span className={metric.changeColor}>{metric.change}</span>
                <span className="text-muted-foreground ml-2">from last week</span>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
