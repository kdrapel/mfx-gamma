import {OpeningSequence} from './opening-sequence.mjs';
import {FastMachine} from './fast-machine.mjs';
export class FastOpeningSequence extends OpeningSequence{
 constructor(memory,metadata,callbacks={}){super(memory,metadata,callbacks);this.machine=new FastMachine(memory,metadata.initial_registers,this.fixture);}
}
