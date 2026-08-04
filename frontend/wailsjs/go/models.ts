export namespace collector {
	
	export class ProcessSample {
	    pid: number;
	    name: string;
	    cpuW: number;
	    gpuW: number;
	    w: number;
	
	    static createFrom(source: any = {}) {
	        return new ProcessSample(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pid = source["pid"];
	        this.name = source["name"];
	        this.cpuW = source["cpuW"];
	        this.gpuW = source["gpuW"];
	        this.w = source["w"];
	    }
	}
	export class Snapshot {
	    ts: time.Time;
	    components: Record<string, number>;
	    processes: ProcessSample[];
	    totalW: number;
	
	    static createFrom(source: any = {}) {
	        return new Snapshot(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ts = this.convertValues(source["ts"], time.Time);
	        this.components = source["components"];
	        this.processes = this.convertValues(source["processes"], ProcessSample);
	        this.totalW = source["totalW"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace config {
	
	export class Settings {
	    costPerKWh: number;
	    currency: string;
	    gridCarbonIntensity: number;
	    forecastWindowDays: number;
	    sampleIntervalSeconds: number;
	    startOnLogin: boolean;
	    theme: string;
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.costPerKWh = source["costPerKWh"];
	        this.currency = source["currency"];
	        this.gridCarbonIntensity = source["gridCarbonIntensity"];
	        this.forecastWindowDays = source["forecastWindowDays"];
	        this.sampleIntervalSeconds = source["sampleIntervalSeconds"];
	        this.startOnLogin = source["startOnLogin"];
	        this.theme = source["theme"];
	    }
	}

}

export namespace forecast {
	
	export class Result {
	    windowDays: number;
	    windowStart: time.Time;
	    windowEnd: time.Time;
	    hoursCovered: number;
	    kWhInWindow: number;
	    avgKWhPerHour: number;
	    stdDevKWhPerHour: number;
	    projectedKWhPerDay: number;
	    projectedKWhMonth: number;
	    projectedCostMonth: number;
	    projectedCO2Kg: number;
	    currency: string;
	    costPerKWh: number;
	    gridCarbonGCO2PerKWh: number;
	    lowKWhMonth: number;
	    highKWhMonth: number;
	    lowCostMonth: number;
	    highCostMonth: number;
	    hasEnoughData: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Result(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.windowDays = source["windowDays"];
	        this.windowStart = this.convertValues(source["windowStart"], time.Time);
	        this.windowEnd = this.convertValues(source["windowEnd"], time.Time);
	        this.hoursCovered = source["hoursCovered"];
	        this.kWhInWindow = source["kWhInWindow"];
	        this.avgKWhPerHour = source["avgKWhPerHour"];
	        this.stdDevKWhPerHour = source["stdDevKWhPerHour"];
	        this.projectedKWhPerDay = source["projectedKWhPerDay"];
	        this.projectedKWhMonth = source["projectedKWhMonth"];
	        this.projectedCostMonth = source["projectedCostMonth"];
	        this.projectedCO2Kg = source["projectedCO2Kg"];
	        this.currency = source["currency"];
	        this.costPerKWh = source["costPerKWh"];
	        this.gridCarbonGCO2PerKWh = source["gridCarbonGCO2PerKWh"];
	        this.lowKWhMonth = source["lowKWhMonth"];
	        this.highKWhMonth = source["highKWhMonth"];
	        this.lowCostMonth = source["lowCostMonth"];
	        this.highCostMonth = source["highCostMonth"];
	        this.hasEnoughData = source["hasEnoughData"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace store {
	
	export class HourlyRollup {
	    hour: time.Time;
	    scope: string;
	    key: string;
	    kWh: number;
	    avgW: number;
	    maxW: number;
	    minutes: number;
	
	    static createFrom(source: any = {}) {
	        return new HourlyRollup(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hour = this.convertValues(source["hour"], time.Time);
	        this.scope = source["scope"];
	        this.key = source["key"];
	        this.kWh = source["kWh"];
	        this.avgW = source["avgW"];
	        this.maxW = source["maxW"];
	        this.minutes = source["minutes"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class KeyTotal {
	    scope: string;
	    key: string;
	    kWh: number;
	    avgW: number;
	    maxW: number;
	
	    static createFrom(source: any = {}) {
	        return new KeyTotal(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.scope = source["scope"];
	        this.key = source["key"];
	        this.kWh = source["kWh"];
	        this.avgW = source["avgW"];
	        this.maxW = source["maxW"];
	    }
	}

}

export namespace time {
	
	export class Time {
	
	
	    static createFrom(source: any = {}) {
	        return new Time(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	
	    }
	}

}

