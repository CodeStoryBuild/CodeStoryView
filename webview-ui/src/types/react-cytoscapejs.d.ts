declare module 'react-cytoscapejs' {
    import { Component } from 'react';
    import { Core, ElementDefinition, StyleSheet, LayoutOptions } from 'cytoscape';

    interface CytoscapeComponentProps {
        id?: string;
        cy?: (cy: Core) => void;
        elements: ElementDefinition[];
        stylesheet?: StyleSheet[];
        layout?: LayoutOptions;
        className?: string;
        style?: React.CSSProperties;
        wheelSensitivity?: number;
        [key: string]: any;
    }

    export default class CytoscapeComponent extends Component<CytoscapeComponentProps> { }
}
