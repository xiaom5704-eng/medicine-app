import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackContent?: string;
}

interface State {
  hasError: boolean;
  errorMsg: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorMsg: ''
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMsg: error.message };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('--- [ 全域錯誤攔截 ] ---');
    console.error('錯誤訊息:', error.message);
    console.error('發生位置 (Stack):', error.stack);
    console.error('組件堆棧 (Component Stack):', errorInfo.componentStack);
    console.error('------------------------');
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallbackContent) {
        return <div className="text-slate-700 whitespace-pre-wrap">{this.props.fallbackContent}</div>;
      }
      return (
        <div className="p-4 rounded-xl bg-red-50 border border-red-100 flex items-start gap-3">
          <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={18} />
          <div className="flex-1">
            <h4 className="text-red-800 font-medium text-sm mb-1">內容渲染失敗</h4>
            <p className="text-red-600/80 text-xs font-mono break-all">{this.state.errorMsg}</p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
