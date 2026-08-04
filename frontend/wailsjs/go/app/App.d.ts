export function Startup(arg1: any): Promise<void> {
    return window['go']['app']['App']['Startup'](arg1);
}

export function Shutdown(arg1: any): Promise<void> {
    return window['go']['app']['App']['Shutdown'](arg1);
}

export function Start(): Promise<void> {
    return window['go']['app']['App']['Start']();
}

export function GetSettings(): Promise<any> {
    return window['go']['app']['App']['GetSettings']();
}

export function UpdateSettings(arg1: any): Promise<void> {
    return window['go']['app']['App']['UpdateSettings'](arg1);
}

export function ViewTotals(arg1: string, arg2: string, arg3: string): Promise<any> {
    return window['go']['app']['App']['ViewTotals'](arg1, arg2, arg3);
}

export function ViewHourly(arg1: string, arg2: string, arg3: string, arg4: string): Promise<any> {
    return window['go']['app']['App']['ViewHourly'](arg1, arg2, arg3, arg4);
}

export function ViewForecast(): Promise<any> {
    return window['go']['app']['App']['ViewForecast']();
}
